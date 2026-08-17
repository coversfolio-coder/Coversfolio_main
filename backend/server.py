from dotenv import load_dotenv

load_dotenv()

import logging
import io
import os
import re
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List
from urllib.parse import quote

import bcrypt
import httpx
import jwt
from docx import Document as DocxDocument
from fastapi import APIRouter, Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from pypdf import PdfReader
import pdfplumber
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable

ROOT_DIR = Path(__file__).parent
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]
JWT_ALGORITHM = "HS256"

JWT_SECRET = os.environ["JWT_SECRET"]
if len(JWT_SECRET) < 32:
    raise RuntimeError("JWT_SECRET must be at least 32 characters long. Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(48))\"")

# Google Sign-In is optional. If GOOGLE_CLIENT_ID is unset, the /auth/google endpoint
# returns a clear error instead of the app failing to start, so email/password auth
# keeps working regardless of whether Google is configured.
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()

# AI-powered document analysis (Gemini) is entirely optional. Unset means the
# feature is off, the "Analyze with AI" button never appears, and every other
# part of the app - including the deterministic regex/table extraction -
# behaves exactly as it does without this configured. Nothing about a
# document ever gets sent to Google unless the person explicitly clicks
# "Analyze with AI" - this is never triggered automatically on upload.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest").strip()

STORAGE_ROOT = Path(os.environ.get("STORAGE_ROOT", str(ROOT_DIR / "storage")))
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)

# Local disk storage works fine for development, but doesn't survive a redeploy
# on most hosting platforms (the container's disk is ephemeral) - STORAGE_BACKEND=s3
# switches to an S3-compatible bucket (DigitalOcean Spaces, AWS S3, etc.) instead,
# with no other code changes required. Local remains the default so existing
# docker-compose setups keep working exactly as before.
STORAGE_BACKEND = os.environ.get("STORAGE_BACKEND", "local").strip().lower()
S3_BUCKET = os.environ.get("S3_BUCKET", "").strip()
S3_ENDPOINT_URL = os.environ.get("S3_ENDPOINT_URL", "").strip()
S3_REGION = os.environ.get("S3_REGION", "").strip()
S3_ACCESS_KEY = os.environ.get("S3_ACCESS_KEY", "").strip()
S3_SECRET_KEY = os.environ.get("S3_SECRET_KEY", "").strip()

if STORAGE_BACKEND == "s3" and not all([S3_BUCKET, S3_ENDPOINT_URL, S3_ACCESS_KEY, S3_SECRET_KEY]):
    raise RuntimeError("STORAGE_BACKEND=s3 requires S3_BUCKET, S3_ENDPOINT_URL, S3_ACCESS_KEY, and S3_SECRET_KEY to all be set")

_s3_client = None


def get_s3_client():
    global _s3_client
    if _s3_client is None:
        import boto3
        _s3_client = boto3.client(
            "s3", endpoint_url=S3_ENDPOINT_URL, region_name=S3_REGION or None,
            aws_access_key_id=S3_ACCESS_KEY, aws_secret_access_key=S3_SECRET_KEY,
        )
    return _s3_client


def storage_save(key: str, contents: bytes, content_type: str) -> str:
    """Saves file contents and returns the reference to store in the document
    record - a local filesystem path when STORAGE_BACKEND=local, or the S3
    object key when STORAGE_BACKEND=s3. Callers should treat the return value
    as opaque and pass it straight to storage_delete/storage_download_response."""
    if STORAGE_BACKEND == "s3":
        get_s3_client().put_object(Bucket=S3_BUCKET, Key=key, Body=contents, ContentType=content_type)
        return key
    path = STORAGE_ROOT / key
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.write(contents)
    return str(path)


def storage_delete(stored_ref: str):
    if STORAGE_BACKEND == "s3":
        get_s3_client().delete_object(Bucket=S3_BUCKET, Key=stored_ref)
        return
    path = Path(stored_ref)
    if path.exists():
        path.unlink()


def storage_exists(stored_ref: str) -> bool:
    if STORAGE_BACKEND == "s3":
        try:
            get_s3_client().head_object(Bucket=S3_BUCKET, Key=stored_ref)
            return True
        except Exception:
            return False
    return Path(stored_ref).exists()
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", 15 * 1024 * 1024))
ALLOWED_UPLOAD_TYPES = {
    "application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic",
    "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

# Recognized document categories. Kept as a fixed, small list (mirrored in the
# frontend dropdown) rather than free text, so the Documents page can group
# uploads meaningfully and the claim compilation feature below has something
# reliable to match against.
DOCUMENT_CATEGORIES = {
    "policy_document": "Policy document",
    "discharge_summary": "Discharge summary",
    "hospital_bill": "Hospital bill",
    "consultation": "Consultation papers",
    "pharmacy_bill": "Pharmacy bill",
    "opd_receipt": "OPD receipt",
    "claim_settlement": "Claim settlement",
    "id_proof": "ID proof",
    "obstetric_history": "Obstetric history (maternity claims)",
    "claim_form": "Insurer claim form",
    "purchase_receipt": "Purchase receipt",
    "general": "Other",
}

# The order insurers commonly expect documents in, per claim type - drawn from
# the cross-insurer pattern in the research brief (claim form, discharge
# summary, itemized bills, prescriptions/consultation, pharmacy bills; cashless
# needs a lighter set since the insurer settles directly with the hospital).
# This is a sensible default ordering, not a guarantee any specific insurer
# requires exactly this - the claim's checklist remains fully editable either way.
CLAIM_DOCUMENT_ORDER = {
    "Reimbursement": ["policy_document", "id_proof", "discharge_summary", "hospital_bill", "consultation", "pharmacy_bill", "opd_receipt"],
    "Cashless": ["policy_document", "id_proof", "discharge_summary"],
}
# Maternity claims have one genuinely extra IRDAI/insurer requirement beyond the
# generic checklist: an obstetric history (Gravida/Para/Living children/
# Abortions) from the treating doctor, submitted as part of the hospital's own
# Claim Form Part B. Added conditionally, not for every claim, since it's
# specific to this claim category.
MATERNITY_EXTRA_CHECKLIST = ["obstetric_history"]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logger = logging.getLogger("coversfolio")


class StatusCheck(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StatusCheckCreate(BaseModel):
    client_name: str


class AuthInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str = Field(default="Household owner", min_length=2, max_length=80)
    consent_given: bool = False


class GoogleSignIn(BaseModel):
    credential: str = Field(min_length=20)
    consent_given: bool = False


class ForgotPasswordInput(BaseModel):
    email: EmailStr


class ResetPasswordInput(BaseModel):
    token: str = Field(min_length=20)
    new_password: str = Field(min_length=8)


class ClaimCreate(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    claim_type: str = Field(pattern="^(Cashless|Reimbursement)$")
    policy_id: str | None = None


class HospitalizationDetails(BaseModel):
    patient_name: str | None = Field(default=None, max_length=120)
    hospital_name: str | None = Field(default=None, max_length=160)
    admission_date: str | None = Field(default=None, max_length=20)
    discharge_date: str | None = Field(default=None, max_length=20)
    diagnosis: str | None = Field(default=None, max_length=300)
    is_maternity: bool | None = None


class InviteCreate(BaseModel):
    email: EmailStr
    role: str = Field(pattern="^(member|agent)$")


class InviteAccept(BaseModel):
    token: str = Field(min_length=20)
    name: str = Field(min_length=2, max_length=80)
    password: str = Field(min_length=8)


class NoteInput(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class QueryInput(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    source: str = Field(default="Insurer", min_length=1, max_length=80)


class QueryResponse(BaseModel):
    response: str = Field(min_length=1, max_length=2000)


class SettlementInput(BaseModel):
    amount: float = Field(gt=0)
    kind: str = Field(default="partial", pattern="^(partial|final|deduction)$")
    note: str = Field(default="", max_length=500)


class StageInput(BaseModel):
    stage: str = Field(min_length=2, max_length=80)
    progress: int = Field(ge=0, le=100)
    note: str = Field(default="", max_length=500)


class StatusInput(BaseModel):
    status: str = Field(pattern="^(rejected|appealed|reopened|settled)$")
    reason: str = Field(default="", max_length=1000)


class InsuredPerson(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    relation: str = Field(min_length=1, max_length=40)
    dob: str = Field(default="", max_length=20)


class PolicyCreate(BaseModel):
    insurer_name: str = Field(min_length=2, max_length=120)
    policy_number: str = Field(min_length=2, max_length=60)
    policy_type: str = Field(pattern="^(Health|Home|Mediclaim)$")
    sum_insured: float = Field(gt=0)
    start_date: str = Field(min_length=4, max_length=20)
    end_date: str = Field(min_length=4, max_length=20)
    insured_people: List[InsuredPerson] = Field(default_factory=list)
    # Optional: carried over from an "Analyze with AI" pass, if the person ran one
    # before saving. Kept loosely-typed (plain dict) rather than importing the
    # PolicyAIAnalysis schema here, since that class is defined further down this
    # file and this avoids a forward-reference tangle for what's just persisted
    # data, not something this endpoint re-validates against the AI schema.
    ai_insights: dict | None = None


class PolicyUpdate(BaseModel):
    insurer_name: str | None = Field(default=None, min_length=2, max_length=120)
    policy_number: str | None = Field(default=None, min_length=2, max_length=60)
    policy_type: str | None = Field(default=None, pattern="^(Health|Home|Mediclaim)$")
    sum_insured: float | None = Field(default=None, gt=0)
    start_date: str | None = Field(default=None, min_length=4, max_length=20)
    end_date: str | None = Field(default=None, min_length=4, max_length=20)
    insured_people: List[InsuredPerson] | None = None
    ai_insights: dict | None = None
    health_checkup_last_used_date: str | None = Field(default=None, min_length=4, max_length=20)


class EvidenceCreate(BaseModel):
    category: str = Field(min_length=2, max_length=60)
    item_name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    purchase_date: str = Field(default="", max_length=20)
    value: float = Field(default=0, ge=0)
    linked_claim_id: str | None = None


class EvidenceUpdate(BaseModel):
    category: str | None = Field(default=None, min_length=2, max_length=60)
    item_name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    purchase_date: str | None = Field(default=None, max_length=20)
    value: float | None = Field(default=None, ge=0)
    linked_claim_id: str | None = None


class ChecklistItemCreate(BaseModel):
    label: str = Field(min_length=1, max_length=160)


DEFAULT_CHECKLIST_LABELS = [
    "Discharge summary", "Hospital final bill", "Prescription records",
    "ID proof of insured person", "Policy copy",
]

# Sourced from IRDAI's 2024 Master Circular on Health Insurance Business and the
# General Insurance Council's "Cashless Everywhere" initiative. The 30-day
# reimbursement figure is the one item flagged as needing primary-source
# verification in the research brief, so its citation note says so explicitly -
# nothing here should be presented to a user as more certain than it is.
SLA_DEFINITIONS = {
    "pre_auth": {
        "label": "Cashless pre-authorization decision", "hours": 1,
        "applicable_to": ["Cashless"],
        "citation": "IRDAI Master Circular on Health Insurance Business (2024): insurer must decide within 1 hour of the hospital's cashless request.",
    },
    "discharge": {
        "label": "Final discharge authorization", "hours": 3,
        "applicable_to": ["Cashless"],
        "citation": "IRDAI Master Circular on Health Insurance Business (2024): final discharge authorization within 3 hours; the insurer bears any resulting extra hospital charges if this is missed.",
    },
    "intimation": {
        "label": "Cashless-anywhere intimation window", "hours": 48,
        "applicable_to": ["Cashless", "Reimbursement"],
        "citation": "General Insurance Council 'Cashless Everywhere' (Jan 2024): notify the insurer 48 hours before a planned procedure, or within 48 hours for emergencies.",
    },
    "reimbursement_decision": {
        "label": "Reimbursement settlement decision", "hours": 720,
        "applicable_to": ["Reimbursement"],
        "citation": "Commonly cited as a 30-day decision window from receipt of the last necessary document - this figure is not yet verified against the primary IRDAI text, so treat it as approximate.",
    },
}


class SlaStart(BaseModel):
    sla_type: str = Field(pattern="^(pre_auth|discharge|intimation|reimbursement_decision)$")
    started_at: str | None = None

# Longest/most-specific names first so substring matching doesn't stop at a shorter
# partial match (e.g. matching "New India Assurance" before the bare word "India").
KNOWN_INSURERS = [
    "Bajaj Allianz", "ICICI Lombard", "HDFC ERGO", "Star Health", "Care Health",
    "Niva Bupa", "Max Bupa", "Manipal Cigna", "ManipalCigna", "Aditya Birla",
    "Cholamandalam MS", "Royal Sundaram", "Universal Sompo", "Future Generali",
    "New India Assurance", "National Insurance", "Oriental Insurance",
    "United India Insurance", "Reliance General", "SBI General", "Tata AIG",
    "Kotak Mahindra", "Liberty General", "Go Digit", "Digit Insurance",
    "Apollo Munich", "Religare", "Acko", "Edelweiss",
]

POLICY_EXTRACT_TYPES = {
    "application/pdf",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

# Verified official locator links, checked directly against each insurer's own
# site rather than third-party aggregators - those were found during review to
# report wildly different hospital counts for the same insurer, which is exactly
# the kind of stale/unreliable data that could cost someone real money if they
# showed up expecting cashless treatment somewhere no longer in-network.
# Deliberately NOT a hospital database we maintain ourselves - authorized-hospital
# lists change often and only the insurer's own live tool is authoritative.
INSURER_HOSPITAL_LOCATORS = {
    "Star Health": {"url": "https://www.starhealth.in/lookup/hospital/", "verified": True},
    "ICICI Lombard": {"url": "https://ilhc.icicilombard.com/Customer/GetHospitalList", "verified": True},
    "HDFC ERGO": {"url": "https://www.hdfcergo.com/", "verified": False},
    "Bajaj Allianz": {"url": "https://www.bajajallianz.com/", "verified": False},
    "Care Health": {"url": "https://www.careinsurance.com/", "verified": False},
    "Niva Bupa": {"url": "https://www.nivabupa.com/", "verified": False},
    "Max Bupa": {"url": "https://www.nivabupa.com/", "verified": False},
    "Tata AIG": {"url": "https://www.tataaig.com/", "verified": False},
    "New India Assurance": {"url": "https://www.newindia.co.in/", "verified": False},
    "National Insurance": {"url": "https://nationalinsurance.nic.co.in/", "verified": False},
}

NETWORK_HOSPITAL_DISCLAIMER = (
    "Hospital networks change often and can vary by exact plan or city. This link "
    "goes straight to the insurer's own site rather than a list we maintain ourselves, "
    "since only they can say what's current. Always confirm cashless eligibility "
    "directly with the hospital's insurance/TPA desk and your insurer before treatment."
)


def extract_document_text(filename: str, content_type: str, data: bytes) -> str:
    ext = Path(filename or "").suffix.lower()
    if content_type == "application/pdf" or ext == ".pdf":
        reader = PdfReader(io.BytesIO(data))
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    if content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document" or ext == ".docx":
        doc = DocxDocument(io.BytesIO(data))
        return "\n".join(p.text for p in doc.paragraphs)
    return data.decode("utf-8", errors="ignore")


def normalize_date_str(raw: str) -> str | None:
    raw = raw.strip()
    for fmt in ("%d-%b-%Y", "%d/%b/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


DATE_PATTERN = r"\d{1,2}-[A-Za-z]{3,9}-\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{2,4}"


def parse_policy_fields(text: str, table_sum_insured: float | None = None) -> dict:
    """Best-effort heuristic extraction. Fields that aren't confidently found are
    left as None rather than guessed, since a wrong guess is worse than a blank
    the person fills in themselves."""
    # Real insurer PDFs (Star Health's renewal schedules, for example) often wrap
    # a single number across a line break inside a table cell, e.g. "1,00,00,0\n00"
    # for what should read as one figure. Joining digits split only by whitespace
    # fixes this without touching anything else in the document.
    normalized = re.sub(r"(?<=\d)\s+(?=\d)", "", text)
    lower = normalized.lower()
    result = {
        "insurer_name": None, "policy_number": None, "policy_type": None, "sum_insured": None,
        "start_date": None, "end_date": None,
    }

    for insurer in KNOWN_INSURERS:
        if insurer.lower() in lower:
            result["insurer_name"] = insurer
            break

    match = re.search(r"policy\s*(?:no\.?|number)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-/]{4,24})", normalized, re.IGNORECASE)
    if match:
        result["policy_number"] = match.group(1).strip()

    # Dates: operate on the raw (non-digit-joined) text, since the sum-insured
    # normalization above can accidentally fuse a year straight into an
    # adjacent time value (e.g. "2025   00:00" -> "202500:00"), which would
    # break date matching for no benefit here.
    period_idx = text.lower().find("period of insurance")
    date_window = text[period_idx:period_idx + 250] if period_idx != -1 else text[:400]
    from_match = re.search(rf"from\s*:?\s*({DATE_PATTERN})", date_window, re.IGNORECASE)
    to_match = re.search(rf"to\s*:?\s*(?:midnight\s+of\s+)?({DATE_PATTERN})", date_window, re.IGNORECASE)
    if from_match:
        result["start_date"] = normalize_date_str(from_match.group(1))
    if to_match:
        result["end_date"] = normalize_date_str(to_match.group(1))

    if table_sum_insured is not None:
        # A table-structure-aware match (see extract_pdf_table_sum_insured) is far
        # more reliable than text-flow guessing, since it reads the actual column
        # the document itself labeled "Sum Insured" - always prefer it when available.
        result["sum_insured"] = table_sum_insured
    else:
        # Fallback for non-tabular documents (DOCX, TXT, simple PDFs): the label
        # immediately followed by a currency figure. Deliberately conservative -
        # it does not search backwards or pick "the biggest nearby number", since
        # that risks grabbing an unrelated ID or customer code instead.
        match = re.search(r"sum\s+insured[^\d₹]{0,25}(?:rs\.?|inr|₹)?\s*([\d][\d,]{3,})", normalized, re.IGNORECASE)
        if match:
            try:
                result["sum_insured"] = float(match.group(1).replace(",", ""))
            except ValueError:
                pass

    if "mediclaim" in lower:
        result["policy_type"] = "Mediclaim"
    elif re.search(r"\bhealth\b", lower):
        result["policy_type"] = "Health"
    elif any(k in lower for k in ("home insurance", "householder", "fire insurance", "property insurance", "house owner")):
        result["policy_type"] = "Home"

    return result


def extract_pdf_table_insured_people(data: bytes) -> list[dict]:
    """Same table-structure-aware approach as extract_pdf_table_sum_insured,
    applied to the 'Details of Insured Persons' table most Indian health
    policy schedules include. Returns [] rather than guessing if no table with
    a recognizable 'Name of the Insured'-style column is found."""
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for page in pdf.pages:
                for table in page.extract_tables() or []:
                    if not table or len(table) < 2:
                        continue
                    header = table[0]
                    name_idx = None
                    relation_idx = None
                    for i, cell in enumerate(header):
                        if not cell:
                            continue
                        cell_norm = re.sub(r"\s+", " ", cell).strip().lower()
                        if "name" in cell_norm and "insured" in cell_norm:
                            name_idx = i
                        if "relation" in cell_norm and "proposer" in cell_norm:
                            relation_idx = i
                    if name_idx is None:
                        continue
                    people = []
                    for row in table[1:]:
                        if name_idx >= len(row) or not row[name_idx]:
                            continue
                        name = re.sub(r"\s+", " ", row[name_idx]).strip()
                        if not name or "pre existing" in name.lower():
                            continue
                        relation = ""
                        if relation_idx is not None and relation_idx < len(row) and row[relation_idx]:
                            relation = re.sub(r"\s+", " ", row[relation_idx]).strip()
                        people.append({"name": name, "relation": relation or "Family member", "dob": ""})
                    if people:
                        return people
    except Exception:
        return []
    return []


def extract_pdf_table_sum_insured(data: bytes) -> float | None:
    """Reads actual table structure (via cell geometry, not linear text flow) to
    find a column literally headed 'Sum Insured' and pull its value from the
    matching data row. This is what makes multi-column insurer tables reliable -
    flattened text often scrambles or concatenates adjacent cells with no
    separator, which no text-based regex can safely untangle."""
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for page in pdf.pages:
                for table in page.extract_tables() or []:
                    if not table or len(table) < 2:
                        continue
                    header = table[0]
                    col_idx = None
                    for i, cell in enumerate(header):
                        if not cell:
                            continue
                        cell_norm = re.sub(r"\s+", " ", cell).strip().lower()
                        if "sum" in cell_norm and "insured" in cell_norm and "optional" not in cell_norm:
                            col_idx = i
                            break
                    if col_idx is None:
                        continue
                    for row in table[1:]:
                        if col_idx >= len(row) or not row[col_idx]:
                            continue
                        raw = re.sub(r"\s+", "", row[col_idx]).replace(",", "")
                        if raw.isdigit():
                            return float(raw)
    except Exception:
        return None
    return None


class MaternityCoverInfo(BaseModel):
    covered: bool = False
    cap_amount: float | None = None
    waiting_period_months: int | None = None
    notes: str | None = None


class PolicySubLimit(BaseModel):
    name: str
    cap_description: str


class WaitingPeriodItem(BaseModel):
    condition: str
    waiting_period_months: float | None = None
    covered: bool = True
    notes: str | None = None


class HealthCheckupBenefit(BaseModel):
    available: bool = False
    frequency_months: int | None = None
    notes: str | None = None


class RestorationBenefit(BaseModel):
    available: bool = False
    notes: str | None = None


class NoClaimBonus(BaseModel):
    available: bool = False
    notes: str | None = None


class PolicyAIAnalysis(BaseModel):
    # Bumped every time a field is added/removed/renamed below. Policies
    # analyzed under an older version won't have newer fields at all (not
    # null - genuinely absent), which is exactly what caused a real crash
    # earlier in this build (maternity_cover accessed as if it always existed).
    # CURRENT_AI_SCHEMA_VERSION is the source of truth for "latest"; this
    # field records what a given policy was actually analyzed under.
    schema_version: int = 2
    insurer_name: str | None = None
    policy_number: str | None = None
    policy_type: str | None = None
    sum_insured: float | None = None
    start_date: str | None = None
    end_date: str | None = None
    maternity_cover: MaternityCoverInfo | None = None
    key_sub_limits: list[PolicySubLimit] = Field(default_factory=list)
    key_exclusions: list[str] = Field(default_factory=list)
    initial_waiting_period_days: int | None = None
    pre_existing_disease_waiting_months: float | None = None
    waiting_periods: list[WaitingPeriodItem] = Field(default_factory=list)
    annual_health_checkup: HealthCheckupBenefit | None = None
    restoration_benefit: RestorationBenefit | None = None
    no_claim_bonus: NoClaimBonus | None = None
    other_benefits: list[str] = Field(default_factory=list)
    summary: str | None = None


# Bump this whenever PolicyAIAnalysis's fields change shape. Anything stored
# under an older version is missing fields outright (not null) - callers that
# read ai_insights should treat every field access as "may not exist" rather
# than assuming the current shape, regardless of what this constant says.
CURRENT_AI_SCHEMA_VERSION = 2


class AIAnalysisUnavailable(Exception):
    """Raised when Gemini isn't configured. Distinct from AIAnalysisFailed so
    callers can return a clean 501 (not configured) vs 502 (configured but the
    call itself failed) - the person needs a different message for each."""


class AIAnalysisFailed(Exception):
    """Raised when Gemini is configured but the actual API call failed or
    returned something we couldn't parse."""


POLICY_AI_PROMPT = """You are analyzing an Indian insurance policy document for a personal claims-organizing app.
Extract ONLY what is explicitly stated in this document. Never invent, estimate, or infer a figure,
date, or term that is not written in the text. If something isn't present, leave that field null or
an empty list rather than guessing - a wrong answer is far worse than an honest blank.

Pay particular attention to:
- The overall sum insured (the base coverage amount, not any single sub-limit or bonus)
- Maternity coverage specifically: is it covered at all, what is the sub-limit/cap amount if any,
  and what waiting period (in months) applies before it can be claimed
- Any other named sub-limits or caps (room rent limits, specific procedure caps, co-payment
  percentages, etc.)
- Key exclusions explicitly listed in the document - things not covered under any circumstance
- The initial/general waiting period in days (commonly called a "cooling period" - the minimum time
  from policy start before ANY illness claim, other than an accident, can be made)
- The waiting period in months for pre-existing diseases specifically (usually the longest waiting
  period in the policy, commonly 2-4 years)
- Named conditions or procedures the document lists with their OWN specific waiting periods - common
  examples include cataract, hernia, hysterectomy, joint replacement/knee surgery, kidney stone
  removal, piles, sinusitis, ENT disorders, and similar planned/non-emergency procedures. For each one
  the document actually names, record the condition, the waiting period in months, and whether it's
  covered at all. Do not invent a list of "commonly expected" conditions - only include what this
  specific document actually states.
- Free annual health checkup / preventive checkup benefit: is one included, how often (in months -
  usually 12), and any conditions attached (e.g. only after a claim-free year)
- Restoration/refill benefit: does the sum insured automatically restore/refill if exhausted during
  the policy year, and under what conditions
- No-claim bonus / cumulative bonus: is one mentioned, and what does it do (increases sum insured,
  gives a premium discount, etc.) - describe what the document says, don't calculate a rupee figure
  unless the document states one directly
- Any other named benefit or service explicitly listed - teleconsultation credits, ambulance cover,
  wellness/gym discounts, second-opinion services, home healthcare, and similar - these are the kinds
  of things policyholders pay for but often never use because they don't know they exist

These benefit-related fields matter as much as the exclusions and waiting periods above - the whole
point is helping someone actually use what they're paying for, not just avoid what's excluded.

Write the summary field as 2-3 plain sentences a non-expert can understand, in the tone of a
knowledgeable friend explaining the policy - not legal or marketing language."""


def analyze_policy_with_gemini(pdf_bytes: bytes) -> dict:
    if not GEMINI_API_KEY:
        raise AIAnalysisUnavailable("AI analysis is not configured on this server")

    client = genai.Client(api_key=GEMINI_API_KEY)
    # Gemini occasionally returns a 503 "currently experiencing high demand -
    # please try again later" - that's Google's own servers being temporarily
    # overloaded, not something wrong with the request, so it's worth a couple
    # of quick automatic retries. A 4xx (bad key, deprecated model, quota
    # exceeded, malformed request) means retrying is pointless - fail
    # immediately instead. Capped at 2 attempts rather than more: the free
    # tier's daily quota is only 20 requests total, and each retry attempt
    # counts against it even when it fails, so being aggressive here burns
    # through a scarce daily allowance faster during exactly the outages this
    # retry exists to smooth over.
    max_attempts = 2
    last_exc = None
    for attempt in range(max_attempts):
        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=[
                    genai_types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
                    POLICY_AI_PROMPT,
                ],
                config=genai_types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=PolicyAIAnalysis,
                    temperature=0.1,
                ),
            )
            parsed = PolicyAIAnalysis.model_validate_json(response.text)
            return parsed.model_dump()
        except genai_errors.ServerError as exc:
            last_exc = exc
            if attempt < max_attempts - 1:
                logger.warning("Gemini server error (attempt %d/%d), retrying: %s", attempt + 1, max_attempts, exc)
                time.sleep(2 * (attempt + 1))
                continue
        except Exception as exc:
            raise AIAnalysisFailed(str(exc)) from exc

    raise AIAnalysisFailed(str(last_exc))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


def create_token(user_id: str, email: str, token_type: str, duration: timedelta) -> str:
    payload = {"sub": user_id, "email": email, "type": token_type, "exp": datetime.now(timezone.utc) + duration}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def public_user(user: dict) -> dict:
    return {"id": user["id"], "email": user["email"], "name": user["name"], "household_id": user["household_id"], "role": user["role"], "picture": user.get("picture"), "auth_provider": user.get("auth_provider", "email")}


async def current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        header = request.headers.get("Authorization", "")
        token = header[7:] if header.startswith("Bearer ") else None
    if not token:
        raise HTTPException(status_code=401, detail="Please sign in to continue")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid session")
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Your session has expired") from exc
    user = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0})
    if not user or user.get("status") == "revoked":
        raise HTTPException(status_code=401, detail="Account not found")
    return user


def set_session(response: Response, user: dict):
    access = create_token(user["id"], user["email"], "access", timedelta(minutes=15))
    refresh = create_token(user["id"], user["email"], "refresh", timedelta(days=7))
    secure = os.environ.get("COOKIE_SECURE", "true").lower() == "true"
    response.set_cookie("access_token", access, httponly=True, secure=secure, samesite="lax", max_age=900, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=secure, samesite="lax", max_age=604800, path="/")


def set_access_cookie_only(response: Response, user: dict):
    access = create_token(user["id"], user["email"], "access", timedelta(minutes=15))
    secure = os.environ.get("COOKIE_SECURE", "true").lower() == "true"
    response.set_cookie("access_token", access, httponly=True, secure=secure, samesite="lax", max_age=900, path="/")


@api_router.get("/")
async def root():
    return {"message": "Coversfolio API"}


async def enforce_rate_limit(request: Request, bucket: str, limit: int, window: timedelta):
    """Simple sliding-window-ish limiter stored in Mongo, keyed by client IP + bucket name."""
    client_ip = request.client.host if request.client else "unknown"
    key = f"{bucket}:{client_ip}"
    now = datetime.now(timezone.utc)
    record = await db.rate_limits.find_one({"key": key}, {"_id": 0})
    if record and datetime.fromisoformat(record["window_start"]) + window > now:
        if record.get("count", 0) >= limit:
            raise HTTPException(status_code=429, detail="Too many requests. Please try again later")
        await db.rate_limits.update_one({"key": key}, {"$inc": {"count": 1}})
    else:
        await db.rate_limits.update_one(
            {"key": key}, {"$set": {"key": key, "count": 1, "window_start": now.isoformat()}}, upsert=True
        )


@api_router.post("/auth/register")
async def register(input: AuthInput, request: Request, response: Response):
    await enforce_rate_limit(request, "register", limit=10, window=timedelta(hours=1))
    if not input.consent_given:
        raise HTTPException(status_code=400, detail="Please agree to the Privacy Policy and Terms of Service to create an account")
    email = str(input.email).lower()
    if await db.users.find_one({"email": email}, {"_id": 0}):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    household_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    user = {
        "id": str(uuid.uuid4()), "email": email, "name": input.name, "password_hash": hash_password(input.password),
        "household_id": household_id, "role": "owner", "created_at": now,
        "consent_given_at": now,
    }
    await db.users.insert_one(user)
    await db.households.insert_one({"id": household_id, "name": f"{input.name}'s household", "city": "India", "members": 1, "owner_id": user["id"]})
    set_session(response, user)
    return public_user(user)


@api_router.post("/auth/login")
async def login(input: AuthInput, request: Request, response: Response):
    email = str(input.email).lower()
    identifier = email
    attempt = await db.login_attempts.find_one({"identifier": identifier}, {"_id": 0})
    now = datetime.now(timezone.utc)
    lock_expired = False
    if attempt and attempt.get("locked_until"):
        locked_until = datetime.fromisoformat(attempt["locked_until"])
        if locked_until > now:
            raise HTTPException(status_code=429, detail="Too many attempts. Please try again in 15 minutes")
        lock_expired = True
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or user.get("status") == "revoked" or not verify_password(input.password, user["password_hash"]):
        # Once a previous lockout window has passed, start the fail count fresh instead
        # of continuing to accumulate from before the lock — otherwise a single new
        # failure re-locks the account immediately.
        count = 1 if lock_expired or not attempt else attempt.get("count", 0) + 1
        update = {"identifier": identifier, "count": count, "updated_at": now.isoformat(), "locked_until": None}
        if count >= 5:
            update["locked_until"] = (now + timedelta(minutes=15)).isoformat()
        await db.login_attempts.update_one({"identifier": identifier}, {"$set": update}, upsert=True)
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    await db.login_attempts.delete_one({"identifier": identifier})
    set_session(response, user)
    return public_user(user)


@api_router.post("/auth/refresh")
async def refresh_access_token(request: Request, response: Response):
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Please sign in again")
    try:
        payload = jwt.decode(refresh_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Please sign in again")
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Please sign in again") from exc
    user = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0})
    if not user or user.get("status") == "revoked":
        raise HTTPException(status_code=401, detail="Please sign in again")
    set_access_cookie_only(response, user)
    return public_user(user)


@api_router.post("/auth/google")
async def google_sign_in(input: GoogleSignIn, response: Response):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=501, detail="Google Sign-In is not configured on this server")
    try:
        payload = google_id_token.verify_oauth2_token(
            input.credential, google_requests.Request(), GOOGLE_CLIENT_ID
        )
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="This Google sign-in could not be verified") from exc
    if payload.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise HTTPException(status_code=401, detail="This Google sign-in could not be verified")
    if not payload.get("email_verified", False):
        raise HTTPException(status_code=401, detail="Please verify your email with Google first")

    email = str(payload.get("email", "")).lower()
    name = payload.get("name") or email.split("@")[0]
    google_id = payload.get("sub")
    picture = payload.get("picture")
    if not email or not google_id:
        raise HTTPException(status_code=502, detail="Google sign-in response was incomplete")

    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        if not input.consent_given:
            raise HTTPException(status_code=400, detail="Please agree to the Privacy Policy and Terms of Service to create an account")
        household_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        user = {
            "id": str(uuid.uuid4()), "email": email, "name": name,
            "household_id": household_id, "role": "owner",
            "auth_provider": "google", "google_id": google_id, "picture": picture,
            "created_at": now, "consent_given_at": now,
        }
        await db.users.insert_one(user)
        await db.households.insert_one({"id": household_id, "name": f"{name}'s household", "city": "India", "members": 1, "owner_id": user["id"]})
    elif user.get("status") == "revoked":
        raise HTTPException(status_code=403, detail="This account's access has been revoked")
    else:
        updates = {"name": name, "picture": picture, "google_id": google_id}
        if not user.get("auth_provider"):
            updates["auth_provider"] = "google"
        await db.users.update_one({"id": user["id"]}, {"$set": updates})
        user.update(updates)

    set_session(response, user)
    return public_user(user)


@api_router.get("/auth/me")
async def me(user: dict = Depends(current_user)):
    return public_user(user)


@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


async def household_for(user: dict) -> dict:
    household = await db.households.find_one({"id": user["household_id"]}, {"_id": 0})
    return household or {"id": user["household_id"], "name": "My household", "city": "India", "members": 1}


async def owner_only(user: dict = Depends(current_user)) -> dict:
    if user.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Only the household owner can manage access")
    return user


async def audit(user: dict, action: str, detail: str, actor_email: str | None = None):
    await db.audit_events.insert_one({"id": str(uuid.uuid4()), "household_id": user["household_id"], "actor_id": user["id"], "actor_name": user.get("name", "Household member"), "actor_email": actor_email or user.get("email"), "action": action, "detail": detail, "created_at": datetime.now(timezone.utc).isoformat()})


@api_router.get("/dashboard")
async def get_dashboard(user: dict = Depends(current_user)):
    await audit(user, "workspace_viewed", "Opened the claim workspace")
    household = await household_for(user)
    full_claims = await db.claims.find({"household_id": user["household_id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    active_policies = await db.policies.count_documents({"household_id": user["household_id"]})

    attention = []
    deadlines = []
    now = datetime.now(timezone.utc)
    for claim in full_claims:
        if claim.get("status") not in ("in_progress", "reopened", "appealed"):
            continue
        for query in claim.get("queries", []):
            if query.get("status") == "open":
                attention.append({"label": f"Insurer query on {claim['id']}", "detail": query.get("question", "")[:80] or "Awaiting your response", "tone": "red"})
        pending_items = [c["label"] for c in claim.get("checklist", []) if not c.get("done")]
        if pending_items:
            attention.append({"label": f"{len(pending_items)} document{'s' if len(pending_items) != 1 else ''} pending on {claim['id']}", "detail": pending_items[0], "tone": "amber"})

        for event in claim.get("sla_events", []):
            if event.get("resolved_at"):
                continue
            started_at = datetime.fromisoformat(event["started_at"])
            if started_at.tzinfo is None:
                started_at = started_at.replace(tzinfo=timezone.utc)
            deadline_at = started_at + timedelta(hours=event["hours"])
            remaining = deadline_at - now
            if remaining.total_seconds() < 0:
                overdue = -remaining
                hours_over = int(overdue.total_seconds() // 3600)
                mins_over = int((overdue.total_seconds() % 3600) // 60)
                overdue_text = f"{hours_over}h {mins_over}m overdue" if hours_over else f"{mins_over}m overdue"
                attention.append({"label": f"SLA missed: {event['label']} on {claim['id']}", "detail": overdue_text, "tone": "red"})
            else:
                deadlines.append({
                    "date": deadline_at.strftime("%d"), "month": deadline_at.strftime("%b").upper(),
                    "label": event["label"], "meta": f"{claim['id']} · due {deadline_at.strftime('%d %b, %I:%M %p')}",
                    "_sort": deadline_at,
                })

    policies = await db.policies.find({"household_id": user["household_id"]}, {"_id": 0}).to_list(100)
    policy_summaries = []
    total_sum_insured = 0.0
    for policy in policies:
        status_info = compute_policy_status(policy.get("end_date", ""))
        utilization = await compute_policy_utilization(user["household_id"], policy["id"], policy.get("sum_insured", 0))
        total_sum_insured += policy.get("sum_insured", 0) or 0
        policy_summaries.append({
            "id": policy["id"], "insurer_name": policy["insurer_name"], "policy_number": policy.get("policy_number"), "policy_type": policy.get("policy_type"),
            "status": status_info["status"], "days_label": status_info["days_label"],
            "remaining_sum_insured": utilization["remaining"], "sum_insured": policy.get("sum_insured", 0),
        })
        if status_info["status"] == "expired":
            attention.append({"label": f"{policy['insurer_name']} policy has expired", "detail": status_info["days_label"], "tone": "red"})
        elif status_info["status"] == "grace_period":
            attention.append({"label": f"{policy['insurer_name']} policy is in its grace period", "detail": status_info["days_label"], "tone": "red"})
        elif status_info["status"] == "active" and status_info["days_remaining"] is not None and status_info["days_remaining"] <= 30:
            attention.append({"label": f"{policy['insurer_name']} policy renews soon", "detail": status_info["days_label"], "tone": "amber"})

    deadlines.sort(key=lambda d: d["_sort"])
    deadlines = [{k: v for k, v in d.items() if k != "_sort"} for d in deadlines[:5]]

    claims = [{k: v for k, v in c.items() if k not in ("household_id", "created_by", "notes", "queries", "settlements", "stage_history", "checklist")} for c in full_claims]

    # Packet readiness per claim - this is the app's actual job (getting a claim
    # ready to file), not settlement, so the primary signal shown per claim is
    # "how compiled is this packet", not a settlement amount or outcome.
    overdue_sla_count = 0
    packets_in_progress = 0
    for claim in claims:
        packet = await get_claim_document_packet(claim["id"], user)
        attached = sum(1 for s in packet["sections"] if s["status"] == "attached")
        total_sections = len(packet["sections"])
        has_open_query = any(q.get("status") == "open" for q in next((c.get("queries", []) for c in full_claims if c["id"] == claim["id"]), []))
        if has_open_query:
            packet_status = "Insurer requested more info"
        elif attached == total_sections:
            packet_status = "Ready to submit"
        else:
            missing = total_sections - attached
            packet_status = f"{missing} document{'s' if missing != 1 else ''} missing"
        claim["packet_status"] = packet_status
        claim["documents_attached"] = attached
        claim["documents_total"] = total_sections
        if packet_status != "Ready to submit" and claim.get("status") in ("in_progress", "reopened", "appealed"):
            packets_in_progress += 1
    for claim in full_claims:
        for event in claim.get("sla_events", []):
            if not event.get("resolved_at"):
                started_at = datetime.fromisoformat(event["started_at"])
                if started_at.tzinfo is None:
                    started_at = started_at.replace(tzinfo=timezone.utc)
                if started_at + timedelta(hours=event["hours"]) < now:
                    overdue_sla_count += 1

    document_count = await db.documents.count_documents({"household_id": user["household_id"]})
    onboarding_steps = [
        {"id": "add_policy", "label": "Add your first policy", "detail": "So Coversfolio knows what you're covered for", "done": len(policies) > 0},
        {"id": "upload_document", "label": "Upload a key document", "detail": "A policy copy, ID proof, or bill - whatever you have on hand", "done": document_count > 0},
        {"id": "start_claim", "label": "You're ready to file a claim", "detail": "Start one whenever you actually need it", "done": len(full_claims) > 0},
    ]
    onboarding = {
        "steps": onboarding_steps,
        "all_done": all(s["done"] for s in onboarding_steps),
        "dismissed": household.get("onboarding_dismissed", False),
    }

    return {
        "household": {"name": household["name"], "city": household["city"], "members": household.get("members", 1), "active_policies": active_policies},
        "claims": claims,
        "attention": attention,
        "deadlines": deadlines,
        "policies": policy_summaries,
        "onboarding": onboarding,
        "kpis": {
            "active_policies": active_policies,
            "insurer_count": len({p["insurer_name"] for p in policies}),
            "total_sum_insured": total_sum_insured,
            "packets_in_progress": packets_in_progress,
            "overdue_sla_count": overdue_sla_count,
        },
    }


@api_router.post("/household/onboarding/dismiss")
async def dismiss_onboarding(user: dict = Depends(current_user)):
    await db.households.update_one({"id": user["household_id"]}, {"$set": {"onboarding_dismissed": True}})
    return {"ok": True}


@api_router.get("/household/members")
async def list_members(user: dict = Depends(current_user)):
    members = await db.users.find({"household_id": user["household_id"]}, {"_id": 0, "password_hash": 0}).to_list(100)
    invites = await db.household_invites.find({"household_id": user["household_id"], "status": "pending"}, {"_id": 0, "token": 0}).to_list(100)
    return {"members": [{"id": m["id"], "name": m["name"], "email": m["email"], "role": m["role"], "status": "active"} for m in members], "invites": invites}


@api_router.get("/household/activity")
async def list_activity(user: dict = Depends(current_user)):
    events = await db.audit_events.find({"household_id": user["household_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"events": events}


@api_router.post("/household/invites")
async def create_invite(input: InviteCreate, user: dict = Depends(owner_only)):
    email = str(input.email).lower()
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing and existing.get("household_id") == user["household_id"]:
        raise HTTPException(status_code=409, detail="This person already has access")
    pending = await db.household_invites.find_one({"household_id": user["household_id"], "email": email, "status": "pending"}, {"_id": 0})
    if pending:
        raise HTTPException(status_code=409, detail="An invitation is already pending")
    token = secrets.token_urlsafe(32)
    invite = {"id": str(uuid.uuid4()), "household_id": user["household_id"], "email": email, "role": input.role, "token": token, "status": "pending", "invited_by": user["id"], "created_at": datetime.now(timezone.utc).isoformat()}
    await db.household_invites.insert_one(invite)
    await audit(user, "member_invited", f"Invited {email} as {input.role}")
    return {"id": invite["id"], "email": email, "role": input.role, "status": "pending", "invite_token": token, "delivery": "Invite link ready to share"}


@api_router.delete("/household/members/{member_id}")
async def revoke_member(member_id: str, user: dict = Depends(owner_only)):
    member = await db.users.find_one({"id": member_id, "household_id": user["household_id"]}, {"_id": 0})
    if not member or member.get("role") == "owner":
        raise HTTPException(status_code=404, detail="Member not found or cannot be revoked")
    await db.users.update_one({"id": member_id}, {"$set": {"status": "revoked", "revoked_at": datetime.now(timezone.utc).isoformat()}})
    await audit(user, "member_revoked", f"Revoked access for {member['email']}")
    return {"ok": True}


@api_router.delete("/household/invites/{invite_id}")
async def revoke_invite(invite_id: str, user: dict = Depends(owner_only)):
    result = await db.household_invites.update_one({"id": invite_id, "household_id": user["household_id"], "status": "pending"}, {"$set": {"status": "revoked", "revoked_at": datetime.now(timezone.utc).isoformat()}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Invitation not found")
    await audit(user, "invite_revoked", "Revoked a pending household invitation")
    return {"ok": True}


@api_router.post("/household/invites/accept")
async def accept_invite(input: InviteAccept, response: Response):
    invite = await db.household_invites.find_one({"token": input.token, "status": "pending"}, {"_id": 0})
    if not invite:
        raise HTTPException(status_code=400, detail="This invitation is no longer valid")
    if await db.users.find_one({"email": invite["email"]}, {"_id": 0}):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user = {"id": str(uuid.uuid4()), "email": invite["email"], "name": input.name, "password_hash": hash_password(input.password), "household_id": invite["household_id"], "role": invite["role"], "created_at": datetime.now(timezone.utc).isoformat()}
    await db.users.insert_one(user)
    await db.household_invites.update_one({"id": invite["id"]}, {"$set": {"status": "accepted", "accepted_at": datetime.now(timezone.utc).isoformat(), "accepted_by": user["id"]}})
    await db.households.update_one({"id": invite["household_id"]}, {"$inc": {"members": 1}})
    await audit(user, "invite_accepted", f"Joined household as {invite['role']}", invite["email"])
    set_session(response, user)
    return public_user(user)


GRACE_PERIOD_DAYS = 30  # Common Indian insurer grace period for renewal after policy expiry - not universal, shown as an estimate, not a guarantee from any specific insurer.


def compute_policy_status(end_date_str: str) -> dict:
    """Returns {status, days_label, days_remaining}. status is one of
    'active', 'grace_period', 'expired'. Dates are compared as calendar days
    in UTC - a policy expiring 'today' is still active through end of day."""
    try:
        end_date = datetime.strptime(end_date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return {"status": "unknown", "days_label": None, "days_remaining": None}
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    days_to_expiry = (end_date - today).days
    grace_end = end_date + timedelta(days=GRACE_PERIOD_DAYS)
    days_to_grace_end = (grace_end - today).days

    if days_to_expiry >= 0:
        return {"status": "active", "days_label": f"{days_to_expiry} day{'s' if days_to_expiry != 1 else ''} left", "days_remaining": days_to_expiry}
    if days_to_grace_end >= 0:
        return {"status": "grace_period", "days_label": f"{days_to_grace_end} day{'s' if days_to_grace_end != 1 else ''} left in grace period", "days_remaining": days_to_grace_end}
    return {"status": "expired", "days_label": f"Expired {abs(days_to_expiry)} days ago", "days_remaining": days_to_expiry}


async def compute_policy_utilization(household_id: str, policy_id: str, sum_insured: float) -> dict:
    """Remaining balance = sum insured minus everything settled (not merely
    claimed) against claims linked to this policy. Deduction-type settlement
    entries reduce the payout, not the household's own utilization, so they're
    excluded the same way the claim detail view already treats them."""
    claims = await db.claims.find({"household_id": household_id, "policy_id": policy_id}, {"_id": 0, "settlements": 1}).to_list(200)
    used = 0.0
    for claim in claims:
        for settlement in claim.get("settlements", []):
            if settlement.get("kind") != "deduction":
                used += settlement.get("amount", 0)
    return {"used": used, "remaining": max(sum_insured - used, 0)}


def compute_waiting_status(start_date_str: str | None, waiting_period_months: float | None) -> dict:
    """Given when the policy actually started and a stated waiting period,
    tells you whether that specific waiting period has genuinely passed yet -
    not just the abstract '24 months' fact, but 'you have 140 days left' based
    on this policy's real inception date."""
    if not start_date_str or waiting_period_months is None:
        return {"covered_now": None, "days_remaining": None}
    try:
        start_date = datetime.strptime(start_date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return {"covered_now": None, "days_remaining": None}
    waiting_end = start_date + timedelta(days=waiting_period_months * 30.44)
    today = datetime.now(timezone.utc)
    if today >= waiting_end:
        return {"covered_now": True, "days_remaining": 0}
    return {"covered_now": False, "days_remaining": (waiting_end - today).days}


async def _public_policy_enriched(policy: dict, household_id: str) -> dict:
    base = _public_policy(policy)
    base["status_info"] = compute_policy_status(policy.get("end_date", ""))
    base["utilization"] = await compute_policy_utilization(household_id, policy["id"], policy.get("sum_insured", 0))

    ai_insights = policy.get("ai_insights")
    if ai_insights:
        start_date = policy.get("start_date")
        # ai_insights.get("maternity_cover", {}) only falls back to {} when the KEY
        # is missing - but Gemini legitimately returns maternity_cover: null (not a
        # missing key) whenever a policy doesn't mention maternity at all, which is
        # the common case. That makes the stored value None, not absent, so the
        # dict-default trick above doesn't help - check for None explicitly instead.
        maternity = ai_insights.get("maternity_cover")
        if maternity and maternity.get("waiting_period_months") is not None:
            maternity["waiting_status"] = compute_waiting_status(start_date, maternity["waiting_period_months"])
        if ai_insights.get("pre_existing_disease_waiting_months") is not None:
            ai_insights["pre_existing_disease_waiting_status"] = compute_waiting_status(start_date, ai_insights["pre_existing_disease_waiting_months"])
        for item in ai_insights.get("waiting_periods") or []:
            item["waiting_status"] = compute_waiting_status(start_date, item.get("waiting_period_months"))

        base["benefits"] = compute_policy_benefits(policy, ai_insights, base["status_info"], base["utilization"])

    return base


def compute_policy_benefits(policy: dict, ai_insights: dict, status_info: dict, utilization: dict) -> dict:
    """Turns the AI-extracted benefit fields into something actionable rather
    than just informational - specifically, whether the free health checkup is
    usable right now given when it was last logged, not just whether the
    policy happens to mention one exists. We never claim to know if it's been
    used unless the person told us - fabricating that would be worse than not
    tracking it at all."""
    result = {}

    checkup = ai_insights.get("annual_health_checkup")
    if checkup and checkup.get("available"):
        last_used = policy.get("health_checkup_last_used_date")
        frequency = checkup.get("frequency_months")
        eligible_now = None
        next_eligible_date = None
        if frequency and last_used:
            try:
                last_used_dt = datetime.strptime(last_used, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                next_dt = last_used_dt + timedelta(days=frequency * 30.44)
                next_eligible_date = next_dt.strftime("%Y-%m-%d")
                eligible_now = datetime.now(timezone.utc) >= next_dt
            except ValueError:
                pass
        elif not last_used:
            eligible_now = True  # No usage logged yet - nothing on record says otherwise
        result["health_checkup"] = {
            "frequency_months": frequency, "notes": checkup.get("notes"),
            "last_used_date": last_used, "next_eligible_date": next_eligible_date, "eligible_now": eligible_now,
        }

    restoration = ai_insights.get("restoration_benefit")
    if restoration and restoration.get("available"):
        result["restoration_benefit"] = {
            "notes": restoration.get("notes"),
            "relevant_now": utilization.get("remaining", 0) <= 0,
        }

    no_claim_bonus = ai_insights.get("no_claim_bonus")
    if no_claim_bonus and no_claim_bonus.get("available"):
        result["no_claim_bonus"] = {"notes": no_claim_bonus.get("notes")}

    if ai_insights.get("other_benefits"):
        result["other_benefits"] = ai_insights["other_benefits"]

    covered_now, still_waiting = [], []
    for item in ai_insights.get("waiting_periods") or []:
        target = covered_now if item.get("waiting_status", {}).get("covered_now") else still_waiting
        target.append(item["condition"])
    if covered_now:
        result["newly_usable_conditions"] = covered_now
    if still_waiting:
        result["still_waiting_conditions"] = still_waiting

    if status_info.get("status") == "grace_period" or (status_info.get("status") == "active" and (status_info.get("days_remaining") or 999) <= 45):
        result["renewal_reminder"] = (
            "Your policy is renewing soon. You have a right to port to a different insurer without losing credit "
            "for waiting periods and continuity benefits already served - this is an IRDAI-guaranteed right, not "
            "something specific to this insurer. Worth comparing before you auto-renew."
        )

    return result


def _public_policy(policy: dict) -> dict:
    return {k: v for k, v in policy.items() if k not in ("_id", "household_id", "created_by")}


@api_router.get("/policies")
async def list_policies(user: dict = Depends(current_user)):
    policies = await db.policies.find({"household_id": user["household_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    enriched = [await _public_policy_enriched(p, user["household_id"]) for p in policies]
    return {"policies": enriched}


@api_router.post("/policies/extract")
async def extract_policy_document(file: UploadFile = File(...), user: dict = Depends(current_user)):
    _require_writer(user)
    if file.content_type not in POLICY_EXTRACT_TYPES:
        raise HTTPException(status_code=415, detail="Upload a PDF, Word document, or plain text file")
    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File is too large. Maximum size is {MAX_UPLOAD_BYTES // (1024*1024)}MB")
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="The uploaded file is empty")

    try:
        text = extract_document_text(file.filename or "", file.content_type, contents)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Could not read this file - it may be corrupted") from exc
    if not text.strip():
        raise HTTPException(status_code=422, detail="No readable text found in this file. Scanned image PDFs aren't supported yet - try a digital copy or type the details in manually.")

    table_sum_insured = extract_pdf_table_sum_insured(contents) if file.content_type == "application/pdf" else None
    fields = parse_policy_fields(text, table_sum_insured=table_sum_insured)
    if file.content_type == "application/pdf":
        insured_people = extract_pdf_table_insured_people(contents)
        if insured_people:
            fields["insured_people"] = insured_people
    await audit(user, "policy_document_scanned", f"Scanned '{file.filename}' for policy details")
    return fields


@api_router.get("/config")
async def get_public_config():
    # Lets the frontend know which optional features are actually configured,
    # without duplicating secrets or client IDs into a second place to keep in
    # sync. Nothing here is sensitive - it's just capability flags.
    return {"ai_enabled": bool(GEMINI_API_KEY), "google_signin_configured": bool(GOOGLE_CLIENT_ID)}


@api_router.post("/policies/extract-ai")
async def extract_policy_document_ai(file: UploadFile = File(...), user: dict = Depends(current_user)):
    _require_writer(user)
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=415, detail="AI analysis currently supports PDF files only")
    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File is too large. Maximum size is {MAX_UPLOAD_BYTES // (1024*1024)}MB")
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="The uploaded file is empty")

    try:
        analysis = analyze_policy_with_gemini(contents)
    except AIAnalysisUnavailable as exc:
        raise HTTPException(status_code=501, detail="AI analysis is not configured on this server yet") from exc
    except AIAnalysisFailed as exc:
        logger.error("Gemini policy analysis failed: %s", exc)
        if "RESOURCE_EXHAUSTED" in str(exc) or "429" in str(exc):
            raise HTTPException(status_code=429, detail="You've hit Gemini's daily free-tier limit (20 requests/day) - try again tomorrow, or add billing to your Google AI Studio project for a higher limit") from exc
        raise HTTPException(status_code=502, detail="AI analysis failed - try the standard scan instead") from exc

    await audit(user, "policy_document_ai_analyzed", f"AI-analyzed '{file.filename}' for policy details")
    analysis["source"] = "ai"
    return analysis


@api_router.post("/policies")
async def create_policy(input: PolicyCreate, user: dict = Depends(current_user)):
    _require_writer(user)
    now = datetime.now(timezone.utc).isoformat()
    policy = {
        "id": str(uuid.uuid4()), "household_id": user["household_id"], "created_by": user["id"],
        "insurer_name": input.insurer_name, "policy_number": input.policy_number, "policy_type": input.policy_type,
        "sum_insured": input.sum_insured, "start_date": input.start_date, "end_date": input.end_date,
        "insured_people": [p.model_dump() for p in input.insured_people],
        "ai_insights": input.ai_insights,
        "created_at": now, "updated_at": now,
    }
    await db.policies.insert_one(policy)
    await audit(user, "policy_added", f"Added {input.insurer_name} policy {input.policy_number}")
    return _public_policy(policy)


@api_router.get("/policies/{policy_id}")
async def get_policy(policy_id: str, user: dict = Depends(current_user)):
    policy = await db.policies.find_one({"id": policy_id, "household_id": user["household_id"]}, {"_id": 0})
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    return await _public_policy_enriched(policy, user["household_id"])


@api_router.get("/geocode/reverse")
async def reverse_geocode(lat: float, lng: float, user: dict = Depends(current_user)):
    """Turns GPS coordinates into a city/state/pincode using OpenStreetMap's
    Nominatim - a real reverse-geocoding lookup, not a language-model guess.
    Deliberately not using Gemini or any AI here: converting coordinates to a
    place name is a deterministic lookup with a purpose-built free service
    available, and guessing it from an LLM would be strictly worse and slower
    for something that has an exact right answer."""
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(status_code=400, detail="Invalid coordinates")
    try:
        async with httpx.AsyncClient(timeout=8) as http_client:
            response = await http_client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"format": "jsonv2", "lat": lat, "lon": lng, "zoom": 12, "addressdetails": 1},
                # Nominatim's usage policy requires an identifying User-Agent for
                # any non-browser client - this is a real requirement, not decoration.
                headers={"User-Agent": "Coversfolio/1.0 (self-hosted claims companion app)"},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Location lookup is temporarily unavailable - please type your city instead") from exc

    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Location lookup is temporarily unavailable - please type your city instead")

    data = response.json()
    address = data.get("address", {})
    city = address.get("city") or address.get("town") or address.get("village") or address.get("municipality") or address.get("county")
    if not city:
        raise HTTPException(status_code=404, detail="Couldn't determine your city from that location - please type it in instead")

    await audit(user, "location_resolved", f"Resolved location to {city}")
    return {"city": city, "state": address.get("state"), "postcode": address.get("postcode")}


def check_condition_against_policy(policy: dict, condition: str) -> dict:
    """Shared logic for matching a condition/diagnosis against a policy's
    AI-extracted waiting periods - used both by the manual 'ask about a
    condition' search and the automatic check run against a claim's own
    diagnosis, so the two never drift out of sync with each other."""
    ai_insights = policy.get("ai_insights")
    if not ai_insights:
        return {
            "matched": False,
            "message": "This policy hasn't been analyzed with AI yet, so we don't have anything to check against. Try 'Analyze with AI' on this policy first.",
        }

    query = condition.strip().lower()
    start_date = policy.get("start_date")
    candidates = []

    maternity = ai_insights.get("maternity_cover")
    if maternity and ("matern" in query or "pregnan" in query or "delivery" in query):
        candidates.append({
            "condition": "Maternity", "covered": maternity.get("covered", False),
            "waiting_period_months": maternity.get("waiting_period_months"), "notes": maternity.get("notes"),
        })

    for item in ai_insights.get("waiting_periods", []):
        item_name = item.get("condition", "").lower()
        if query in item_name or item_name in query:
            candidates.append(item)

    if not candidates:
        return {
            "matched": False,
            "message": f"'{condition}' isn't specifically named in what we extracted from this policy. That doesn't necessarily mean it's excluded - check the document's full exclusions list, or ask your insurer directly before assuming either way.",
            "pre_existing_disease_waiting_months": ai_insights.get("pre_existing_disease_waiting_months"),
        }

    best = candidates[0]
    waiting_status = compute_waiting_status(start_date, best.get("waiting_period_months"))
    return {
        "matched": True, "condition": best.get("condition"), "covered": best.get("covered", True),
        "waiting_period_months": best.get("waiting_period_months"), "notes": best.get("notes"),
        "waiting_status": waiting_status,
    }


@api_router.get("/policies/{policy_id}/check-condition")
async def check_condition(policy_id: str, condition: str, user: dict = Depends(current_user)):
    policy = await db.policies.find_one({"id": policy_id, "household_id": user["household_id"]}, {"_id": 0})
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    return check_condition_against_policy(policy, condition)


@api_router.get("/policies/{policy_id}/network-hospitals")
async def get_network_hospitals(policy_id: str, city: str | None = None, user: dict = Depends(current_user)):
    policy = await db.policies.find_one({"id": policy_id, "household_id": user["household_id"]}, {"_id": 0})
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    insurer_name = policy.get("insurer_name", "")
    matched_key = next((name for name in INSURER_HOSPITAL_LOCATORS if name.lower() in insurer_name.lower()), None)

    if matched_key:
        entry = INSURER_HOSPITAL_LOCATORS[matched_key]
        result = {
            "insurer_name": insurer_name, "locator_url": entry["url"], "matched": True,
            "verified": entry["verified"],
            "note": ("Opens the insurer's own hospital search tool - enter your city or pincode there once it loads." if entry["verified"]
                      else "Opens the insurer's homepage - look for 'Network Hospitals' or 'Hospital Locator' in their site menu."),
        }
    else:
        query = f"{insurer_name} network hospital list"
        if city:
            query += f" {city}"
        result = {
            "insurer_name": insurer_name,
            "locator_url": f"https://www.google.com/search?q={quote(query)}",
            "matched": False, "verified": False,
            "note": "We don't have a direct link for this insurer yet, so this searches for their official page instead.",
        }

    result["disclaimer"] = NETWORK_HOSPITAL_DISCLAIMER
    await audit(user, "network_hospitals_viewed", f"Looked up network hospitals for {insurer_name}")
    return result


@api_router.put("/policies/{policy_id}")
async def update_policy(policy_id: str, input: PolicyUpdate, user: dict = Depends(current_user)):
    _require_writer(user)
    policy = await db.policies.find_one({"id": policy_id, "household_id": user["household_id"]}, {"_id": 0})
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    updates = {k: v for k, v in input.model_dump(exclude_unset=True).items() if v is not None}
    if "insured_people" in updates:
        updates["insured_people"] = [p if isinstance(p, dict) else p.model_dump() for p in updates["insured_people"]]
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.policies.update_one({"id": policy_id, "household_id": user["household_id"]}, {"$set": updates})
    await audit(user, "policy_updated", f"Updated policy {policy.get('policy_number')}")
    refreshed = await db.policies.find_one({"id": policy_id, "household_id": user["household_id"]}, {"_id": 0})
    return await _public_policy_enriched(refreshed, user["household_id"])


@api_router.delete("/policies/{policy_id}")
async def delete_policy(policy_id: str, user: dict = Depends(current_user)):
    _require_writer(user)
    result = await db.policies.delete_one({"id": policy_id, "household_id": user["household_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Policy not found")
    await audit(user, "policy_removed", f"Removed policy {policy_id}")
    return {"ok": True}


def _public_evidence(item: dict) -> dict:
    return {k: v for k, v in item.items() if k not in ("_id", "household_id", "created_by")}


@api_router.get("/evidence")
async def list_evidence(user: dict = Depends(current_user)):
    items = await db.evidence.find({"household_id": user["household_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"items": [_public_evidence(i) for i in items]}


@api_router.post("/evidence")
async def create_evidence(input: EvidenceCreate, user: dict = Depends(current_user)):
    _require_writer(user)
    now = datetime.now(timezone.utc).isoformat()
    item = {
        "id": str(uuid.uuid4()), "household_id": user["household_id"], "created_by": user["id"],
        "category": input.category, "item_name": input.item_name, "description": input.description,
        "purchase_date": input.purchase_date, "value": input.value, "linked_claim_id": input.linked_claim_id,
        "document_ids": [], "created_at": now, "updated_at": now,
    }
    await db.evidence.insert_one(item)
    await audit(user, "evidence_added", f"Added inventory item '{input.item_name}'")
    return _public_evidence(item)


@api_router.put("/evidence/{item_id}")
async def update_evidence(item_id: str, input: EvidenceUpdate, user: dict = Depends(current_user)):
    _require_writer(user)
    item = await db.evidence.find_one({"id": item_id, "household_id": user["household_id"]}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    updates = {k: v for k, v in input.model_dump(exclude_unset=True).items()}
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.evidence.update_one({"id": item_id, "household_id": user["household_id"]}, {"$set": updates})
    await audit(user, "evidence_updated", f"Updated inventory item '{item.get('item_name')}'")
    return {**_public_evidence(item), **updates}


@api_router.delete("/evidence/{item_id}")
async def delete_evidence(item_id: str, user: dict = Depends(current_user)):
    _require_writer(user)
    result = await db.evidence.delete_one({"id": item_id, "household_id": user["household_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    await audit(user, "evidence_removed", f"Removed inventory item {item_id}")
    return {"ok": True}


def _safe_filename(name: str) -> str:
    keep = "".join(c for c in name if c.isalnum() or c in "._- ")
    return keep.strip().replace(" ", "_")[:120] or "file"


def _public_document(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k not in ("_id", "household_id", "stored_path", "uploaded_by")}


@api_router.get("/documents")
async def list_documents(claim_id: str | None = None, policy_id: str | None = None, evidence_id: str | None = None, user: dict = Depends(current_user)):
    query = {"household_id": user["household_id"]}
    if claim_id:
        query["linked_claim_id"] = claim_id
    if policy_id:
        query["linked_policy_id"] = policy_id
    if evidence_id:
        query["linked_evidence_id"] = evidence_id
    docs = await db.documents.find(query, {"_id": 0}).sort("uploaded_at", -1).to_list(500)
    return {"documents": [_public_document(d) for d in docs]}


@api_router.post("/documents")
async def upload_document(
    file: UploadFile = File(...),
    category: str = Form(default="general"),
    linked_claim_id: str | None = Form(default=None),
    linked_policy_id: str | None = Form(default=None),
    linked_evidence_id: str | None = Form(default=None),
    checklist_item_id: str | None = Form(default=None),
    bill_amount: float | None = Form(default=None),
    bill_date: str | None = Form(default=None),
    user: dict = Depends(current_user),
):
    _require_writer(user)
    if file.content_type not in ALLOWED_UPLOAD_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported file type. Upload a PDF, image, or Word document")
    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File is too large. Maximum size is {MAX_UPLOAD_BYTES // (1024*1024)}MB")
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="The uploaded file is empty")

    doc_id = str(uuid.uuid4())
    ext = Path(_safe_filename(file.filename or "")).suffix
    storage_key = f"{user['household_id']}/{doc_id}{ext}"
    stored_path = storage_save(storage_key, contents, file.content_type)

    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": doc_id, "household_id": user["household_id"], "uploaded_by": user["id"],
        "uploaded_by_name": user.get("name", ""), "filename": _safe_filename(file.filename or "document"),
        "content_type": file.content_type, "size": len(contents), "category": category,
        "linked_claim_id": linked_claim_id, "linked_policy_id": linked_policy_id, "linked_evidence_id": linked_evidence_id,
        "bill_amount": bill_amount, "bill_date": bill_date,
        "stored_path": str(stored_path), "uploaded_at": now,
    }
    await db.documents.insert_one(doc)

    if linked_evidence_id:
        await db.evidence.update_one({"id": linked_evidence_id, "household_id": user["household_id"]}, {"$push": {"document_ids": doc_id}})
    if checklist_item_id and linked_claim_id:
        await db.claims.update_one(
            {"id": linked_claim_id, "household_id": user["household_id"], "checklist.id": checklist_item_id},
            {"$set": {"checklist.$.done": True, "checklist.$.document_id": doc_id}},
        )

    await audit(user, "document_uploaded", f"Uploaded '{doc['filename']}'")

    # Best-effort: if this looks like a policy document, either link it to a policy
    # that's already on file, or surface what we found so the person can review and
    # add it as a new policy in one step. Extraction failing here must never break
    # an ordinary document upload, so any error is swallowed.
    detected_policy = None
    if not linked_policy_id and file.content_type in POLICY_EXTRACT_TYPES:
        try:
            text = extract_document_text(doc["filename"], file.content_type, contents)
            table_sum_insured = extract_pdf_table_sum_insured(contents) if file.content_type == "application/pdf" else None
            fields = parse_policy_fields(text, table_sum_insured=table_sum_insured)
        except Exception:
            fields = {}
        if fields.get("insurer_name") or fields.get("policy_number"):
            matched = None
            if fields.get("policy_number"):
                matched = await db.policies.find_one({
                    "household_id": user["household_id"],
                    "policy_number": {"$regex": f"^{re.escape(fields['policy_number'])}$", "$options": "i"},
                }, {"_id": 0})
            if matched:
                await db.documents.update_one({"id": doc_id}, {"$set": {"linked_policy_id": matched["id"]}})
                doc["linked_policy_id"] = matched["id"]
                detected_policy = {"matched_existing": True, "policy_id": matched["id"], "insurer_name": matched["insurer_name"], "policy_number": matched["policy_number"]}
            else:
                detected_policy = {"matched_existing": False, **fields}

    result = _public_document(doc)
    if detected_policy:
        result["detected_policy"] = detected_policy
    return result


@api_router.get("/documents/{document_id}/download")
async def download_document(document_id: str, user: dict = Depends(current_user)):
    doc = await db.documents.find_one({"id": document_id, "household_id": user["household_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if STORAGE_BACKEND == "s3":
        if not storage_exists(doc["stored_path"]):
            raise HTTPException(status_code=404, detail="File is no longer available")
        # A short-lived presigned URL - the client downloads directly from
        # object storage rather than proxying the file's bytes through our own
        # server, which is both faster and cheaper at any real scale.
        url = get_s3_client().generate_presigned_url(
            "get_object", Params={"Bucket": S3_BUCKET, "Key": doc["stored_path"],
                                   "ResponseContentDisposition": f'attachment; filename="{doc["filename"]}"'},
            ExpiresIn=300,
        )
        return RedirectResponse(url)
    path = Path(doc["stored_path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="File is no longer available")
    return FileResponse(path, media_type=doc["content_type"], filename=doc["filename"])


@api_router.delete("/documents/{document_id}")
async def delete_document(document_id: str, user: dict = Depends(current_user)):
    _require_writer(user)
    doc = await db.documents.find_one({"id": document_id, "household_id": user["household_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    storage_delete(doc["stored_path"])
    await db.documents.delete_one({"id": document_id, "household_id": user["household_id"]})
    await audit(user, "document_removed", f"Removed '{doc['filename']}'")
    return {"ok": True}


class DocumentLinkInput(BaseModel):
    linked_claim_id: str | None = None


@api_router.post("/documents/{document_id}/link")
async def link_document_to_claim(document_id: str, input: DocumentLinkInput, user: dict = Depends(current_user)):
    _require_writer(user)
    doc = await db.documents.find_one({"id": document_id, "household_id": user["household_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if input.linked_claim_id:
        claim = await db.claims.find_one({"id": input.linked_claim_id, "household_id": user["household_id"]}, {"_id": 0, "id": 1})
        if not claim:
            raise HTTPException(status_code=404, detail="That claim wasn't found in your household")
    await db.documents.update_one({"id": document_id, "household_id": user["household_id"]}, {"$set": {"linked_claim_id": input.linked_claim_id}})
    await audit(user, "document_linked", f"Linked '{doc['filename']}' to {input.linked_claim_id or 'no claim'}")
    return {"ok": True}


@api_router.get("/claims/{claim_id}/document-packet")
async def get_claim_document_packet(claim_id: str, user: dict = Depends(current_user)):
    """Organizes documents into the order insurers commonly expect them for
    this claim type. Sections already linked to the claim show their attached
    documents; sections that aren't yet linked show any matching-category
    document already on file (from the same policy) as a one-click suggestion,
    or are flagged missing if nothing matches at all."""
    claim = await _load_claim(claim_id, user)
    order = list(CLAIM_DOCUMENT_ORDER.get(claim["type"], CLAIM_DOCUMENT_ORDER["Reimbursement"]))
    if claim.get("is_maternity"):
        order += [cat for cat in MATERNITY_EXTRA_CHECKLIST if cat not in order]

    if claim.get("policy_id"):
        policy = await db.policies.find_one({"id": claim["policy_id"], "household_id": user["household_id"]}, {"_id": 0})
        maternity = (policy.get("ai_insights") or {}).get("maternity_cover") if policy else None
        if maternity and maternity.get("covered"):
            order = order + MATERNITY_EXTRA_CHECKLIST

    linked_docs = await db.documents.find({"household_id": user["household_id"], "linked_claim_id": claim_id}, {"_id": 0}).to_list(200)
    linked_by_category: dict = {}
    for doc in linked_docs:
        linked_by_category.setdefault(doc.get("category", "general"), []).append(_public_document(doc))

    suggestion_query = {"household_id": user["household_id"], "linked_claim_id": None}
    if claim.get("policy_id"):
        suggestion_query["linked_policy_id"] = claim["policy_id"]
    candidate_docs = await db.documents.find(suggestion_query, {"_id": 0}).to_list(200) if claim.get("policy_id") else []
    suggestions_by_category: dict = {}
    for doc in candidate_docs:
        suggestions_by_category.setdefault(doc.get("category", "general"), []).append(_public_document(doc))

    sections = []
    for category in order:
        attached = linked_by_category.get(category, [])
        suggested = [] if attached else suggestions_by_category.get(category, [])
        sections.append({
            "category": category,
            "label": DOCUMENT_CATEGORIES.get(category, category),
            "attached": attached,
            "suggested": suggested,
            "status": "attached" if attached else ("suggested" if suggested else "missing"),
        })

    complete_count = sum(1 for s in sections if s["status"] == "attached")
    return {"sections": sections, "complete_count": complete_count, "total_count": len(sections)}


@api_router.put("/claims/{claim_id}/hospitalization")
async def update_hospitalization_details(claim_id: str, input: HospitalizationDetails, user: dict = Depends(current_user)):
    _require_writer(user)
    claim = await _load_claim(claim_id, user)
    updates = {k: v for k, v in input.model_dump(exclude_unset=True).items() if v is not None}
    if updates:
        await db.claims.update_one({"id": claim_id, "household_id": user["household_id"]}, {"$set": updates})
    # If maternity was just turned on and the checklist already exists (was seeded
    # before this was known), add the extra requirement retroactively rather than
    # requiring the person to notice and add it manually.
    if updates.get("is_maternity") and claim.get("checklist") is not None:
        existing_labels = {item["label"] for item in claim["checklist"]}
        for key in MATERNITY_EXTRA_CHECKLIST:
            label = DOCUMENT_CATEGORIES[key]
            if label not in existing_labels:
                await db.claims.update_one(
                    {"id": claim_id, "household_id": user["household_id"]},
                    {"$push": {"checklist": {"id": str(uuid.uuid4()), "label": label, "done": False, "document_id": None}}},
                )
    if updates:
        await audit(user, "hospitalization_updated", f"Updated hospitalization details on {claim_id}")
    claim = await _load_claim(claim_id, user)
    return _public_claim(claim)


def bucket_bill_date(bill_date: str | None, admission_date: str | None, discharge_date: str | None) -> str:
    """Classifies a bill as pre/during/post-hospitalization relative to the
    claim's actual admission and discharge dates - exactly the three buckets
    every Indian insurer's Claim Form Part A itemizes separately. Falls back to
    'unknown' rather than guessing when dates are missing, since silently
    mis-bucketing a bill would produce a wrong claim total."""
    if not bill_date or not admission_date or not discharge_date:
        return "unknown"
    try:
        bill = datetime.strptime(bill_date, "%Y-%m-%d")
        admission = datetime.strptime(admission_date, "%Y-%m-%d")
        discharge = datetime.strptime(discharge_date, "%Y-%m-%d")
    except ValueError:
        return "unknown"
    if bill < admission:
        return "pre_hospitalization"
    if bill > discharge:
        return "post_hospitalization"
    return "hospitalization"


@api_router.get("/claims/{claim_id}/claim-form")
async def generate_claim_form(claim_id: str, user: dict = Depends(current_user)):
    """Generates the Part A equivalent every Indian insurer's reimbursement
    claim form requires - policy and insured-person details, hospitalization
    details, and bills bucketed and totaled into pre/during/post-hospitalization
    exactly like the real form does. This fills in what the app already knows;
    it does not replace the insurer's own form (which needs your signature) or
    the hospital-filled Part B (which needs theirs) - it's the summary that
    makes filling either one out from scratch unnecessary."""
    claim = await _load_claim(claim_id, user)
    household = await household_for(user)

    policy = None
    if claim.get("policy_id"):
        policy = await db.policies.find_one({"id": claim["policy_id"], "household_id": user["household_id"]}, {"_id": 0})

    all_docs = await db.documents.find({"household_id": user["household_id"], "linked_claim_id": claim_id}, {"_id": 0}).to_list(500)
    admission_date = claim.get("admission_date")
    discharge_date = claim.get("discharge_date")

    buckets = {"pre_hospitalization": [], "hospitalization": [], "post_hospitalization": [], "unknown": []}
    for doc in all_docs:
        if doc.get("bill_amount") is None:
            continue
        bucket = bucket_bill_date(doc.get("bill_date"), admission_date, discharge_date)
        buckets[bucket].append({
            "filename": doc["filename"], "category": DOCUMENT_CATEGORIES.get(doc.get("category", "general"), "Other"),
            "amount": doc["bill_amount"], "bill_date": doc.get("bill_date"),
        })

    totals = {bucket: round(sum(item["amount"] for item in items), 2) for bucket, items in buckets.items()}
    grand_total = round(sum(totals.values()), 2)

    packet = await get_claim_document_packet(claim_id, user)

    # The whole point of extracting waiting periods and exclusions earlier is
    # to use them right here - checking the claim's own diagnosis against its
    # own policy automatically, rather than making the person remember to look
    # it up themselves before submitting something that might get rejected.
    coverage_check = None
    if policy and claim.get("diagnosis"):
        coverage_check = check_condition_against_policy(policy, claim["diagnosis"])

    return {
        "household_name": household["name"],
        "policy": {
            "insurer_name": policy.get("insurer_name") if policy else None,
            "policy_number": policy.get("policy_number") if policy else None,
            "sum_insured": policy.get("sum_insured") if policy else None,
        } if policy else None,
        "claim": {
            "id": claim["id"], "type": claim["type"], "title": claim.get("title"),
            "patient_name": claim.get("patient_name"), "hospital_name": claim.get("hospital_name"),
            "admission_date": admission_date, "discharge_date": discharge_date,
            "diagnosis": claim.get("diagnosis"),
        },
        "bills": {
            "pre_hospitalization": {"items": buckets["pre_hospitalization"], "total": totals["pre_hospitalization"]},
            "hospitalization": {"items": buckets["hospitalization"], "total": totals["hospitalization"]},
            "post_hospitalization": {"items": buckets["post_hospitalization"], "total": totals["post_hospitalization"]},
            "unclassified": {"items": buckets["unknown"], "total": totals["unknown"], "note": "No bill date/amount entered, or entered outside the admission-discharge range - couldn't be bucketed automatically."},
        },
        "grand_total": grand_total,
        "document_checklist": packet["sections"],
        "missing_hospitalization_dates": not admission_date or not discharge_date,
        "coverage_check": coverage_check,
    }


def render_claim_form_pdf(data: dict) -> io.BytesIO:
    """Turns the computed claim-form data into an actual downloadable document -
    not a replacement for the insurer's own Part A/Part B forms (those need real
    signatures), but a ready reference that has every figure and document status
    already worked out, so filling the insurer's form becomes transcription
    rather than a from-scratch reconstruction from a shoebox of receipts."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=18 * mm, bottomMargin=18 * mm, leftMargin=18 * mm, rightMargin=18 * mm)
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="ClaimTitle", fontSize=17, leading=21, spaceAfter=4, textColor=colors.HexColor("#011b51")))
    styles.add(ParagraphStyle(name="ClaimSectionHeading", fontSize=11, leading=14, spaceBefore=14, spaceAfter=6, textColor=colors.HexColor("#011b51")))
    styles.add(ParagraphStyle(name="ClaimBody", fontSize=9.5, leading=13))
    styles.add(ParagraphStyle(name="ClaimMuted", fontSize=8, leading=11, textColor=colors.HexColor("#666666")))

    story = []
    story.append(Paragraph("Reimbursement Claim Summary", styles["ClaimTitle"]))
    story.append(Paragraph(
        "This is a reference document generated by Coversfolio, not the insurer's official claim form. "
        "It compiles what you've already recorded so filling the insurer's actual Part A form (and getting "
        "Part B completed by the hospital) is quick transcription instead of starting from scratch. "
        "Bank details and your signature still need to go directly on the insurer's own form.",
        styles["ClaimMuted"],
    ))
    story.append(Spacer(1, 10))

    def kv_table(rows, col_widths=(55 * mm, 115 * mm)):
        t = Table([[Paragraph(f"<b>{k}</b>", styles["ClaimBody"]), Paragraph(str(v) if v not in (None, "") else "—", styles["ClaimBody"])] for k, v in rows], colWidths=col_widths)
        t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
        ]))
        return t

    story.append(Paragraph("Policy details", styles["ClaimSectionHeading"]))
    policy = data.get("policy") or {}
    story.append(kv_table([
        ("Household", data.get("household_name")),
        ("Insurer", policy.get("insurer_name")),
        ("Policy number", policy.get("policy_number")),
        ("Sum insured", f"Rs. {policy.get('sum_insured'):,.0f}" if policy.get("sum_insured") else None),
    ]))

    story.append(Paragraph("Hospitalization details", styles["ClaimSectionHeading"]))
    claim = data["claim"]
    if data.get("missing_hospitalization_dates"):
        story.append(Paragraph("Admission and discharge dates haven't been entered yet - bills below couldn't be sorted into pre/during/post-hospitalization without them.", styles["ClaimMuted"]))
        story.append(Spacer(1, 4))
    story.append(kv_table([
        ("Claim ID", claim.get("id")), ("Patient", claim.get("patient_name")),
        ("Hospital", claim.get("hospital_name")), ("Diagnosis", claim.get("diagnosis")),
        ("Admission date", claim.get("admission_date")), ("Discharge date", claim.get("discharge_date")),
    ]))

    coverage_check = data.get("coverage_check")
    if coverage_check:
        story.append(Paragraph("Coverage check for this diagnosis", styles["ClaimSectionHeading"]))
        if coverage_check.get("matched"):
            ws = coverage_check.get("waiting_status") or {}
            if not coverage_check.get("covered"):
                status_text = "Not covered, per what was extracted from this policy."
            elif ws.get("covered_now") is False:
                status_text = f"Waiting period still active - {ws.get('days_remaining')} days remaining before this would be covered."
            elif ws.get("covered_now") is True:
                status_text = "Waiting period has passed - covered as of today, per what was extracted."
            else:
                status_text = "Covered, no waiting period stated for this condition."
            story.append(Paragraph(f"<b>{coverage_check.get('condition')}:</b> {status_text}", styles["ClaimBody"]))
            if coverage_check.get("notes"):
                story.append(Paragraph(coverage_check["notes"], styles["ClaimMuted"]))
        else:
            story.append(Paragraph(coverage_check.get("message", ""), styles["ClaimMuted"]))
        story.append(Spacer(1, 4))

    story.append(Paragraph("Claimed expenses, by category", styles["ClaimSectionHeading"]))
    bills = data["bills"]
    bucket_labels = [
        ("pre_hospitalization", "Pre-hospitalization"), ("hospitalization", "Hospitalization (main)"),
        ("post_hospitalization", "Post-hospitalization"), ("unclassified", "Unclassified"),
    ]
    bill_rows = [["Category", "Documents", "Amount (Rs.)"]]
    for key, label in bucket_labels:
        bucket = bills[key]
        bill_rows.append([label, str(len(bucket["items"])), f"{bucket['total']:,.2f}"])
    bill_rows.append(["Grand total", "", f"{data['grand_total']:,.2f}"])
    bt = Table(bill_rows, colWidths=(75 * mm, 40 * mm, 55 * mm))
    bt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#011b51")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5), ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 1), (-1, -2), 0.4, colors.HexColor("#e2e8f0")),
        ("LINEABOVE", (0, -1), (-1, -1), 1, colors.HexColor("#011b51")),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
    ]))
    story.append(bt)

    for key, label in bucket_labels:
        items = bills[key]["items"]
        if not items:
            continue
        story.append(Spacer(1, 8))
        story.append(Paragraph(f"<b>{label}</b>", styles["ClaimBody"]))
        rows = [["Document", "Bill date", "Amount (Rs.)"]] + [[it["filename"], it.get("bill_date") or "—", f"{it['amount']:,.2f}"] for it in items]
        it_table = Table(rows, colWidths=(90 * mm, 35 * mm, 45 * mm))
        it_table.setStyle(TableStyle([
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
            ("ALIGN", (2, 0), (2, -1), "RIGHT"),
            ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.HexColor("#eef1f3")),
            ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        story.append(it_table)
    if bills["unclassified"]["items"]:
        story.append(Paragraph(bills["unclassified"]["note"], styles["ClaimMuted"]))

    story.append(Paragraph("Document checklist", styles["ClaimSectionHeading"]))
    status_color = {"attached": colors.HexColor("#0b7a67"), "suggested": colors.HexColor("#8a5c0a"), "missing": colors.HexColor("#9a2b2b")}
    status_label_map = {"attached": "Attached", "suggested": "Suggested, not yet linked", "missing": "Missing"}
    checklist_rows = [["Document", "Status"]]
    row_colors = []
    for section in data["document_checklist"]:
        checklist_rows.append([section["label"], status_label_map.get(section["status"], section["status"])])
        row_colors.append(status_color.get(section["status"], colors.black))
    ct = Table(checklist_rows, colWidths=(110 * mm, 60 * mm))
    ct_style = [
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.HexColor("#eef1f3")),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    for i, color in enumerate(row_colors, start=1):
        ct_style.append(("TEXTCOLOR", (1, i), (1, i), color))
    ct.setStyle(TableStyle(ct_style))
    story.append(ct)

    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", color=colors.HexColor("#e2e8f0")))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "Remember: this summary does not replace the insurer's Claim Form Part A (needs your signature) or "
        "Part B (needs the hospital's declaration and signature). Bank account details for reimbursement also "
        "go directly on the insurer's form, not here.",
        styles["ClaimMuted"],
    ))

    doc.build(story)
    buf.seek(0)
    return buf


@api_router.get("/claims/{claim_id}/claim-form-pdf")
async def download_claim_form_pdf(claim_id: str, user: dict = Depends(current_user)):
    data = await generate_claim_form(claim_id, user)
    pdf_buf = render_claim_form_pdf(data)
    await audit(user, "claim_form_downloaded", f"Downloaded claim form summary for {claim_id}")
    return StreamingResponse(
        pdf_buf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="claim-summary-{claim_id}.pdf"'},
    )


@api_router.get("/claims/{claim_id}/checklist")
async def get_checklist(claim_id: str, user: dict = Depends(current_user)):
    claim = await _load_claim(claim_id, user)
    checklist = claim.get("checklist")
    if checklist is None:
        labels = list(DEFAULT_CHECKLIST_LABELS)
        if claim.get("is_maternity"):
            labels += [DOCUMENT_CATEGORIES[key] for key in MATERNITY_EXTRA_CHECKLIST]
        checklist = [{"id": str(uuid.uuid4()), "label": label, "done": False, "document_id": None} for label in labels]
        await db.claims.update_one({"id": claim_id, "household_id": user["household_id"]}, {"$set": {"checklist": checklist}})
    return {"checklist": checklist}


@api_router.post("/claims/{claim_id}/checklist")
async def add_checklist_item(claim_id: str, input: ChecklistItemCreate, user: dict = Depends(current_user)):
    _require_writer(user)
    await _load_claim(claim_id, user)
    item = {"id": str(uuid.uuid4()), "label": input.label, "done": False, "document_id": None}
    await db.claims.update_one({"id": claim_id, "household_id": user["household_id"]}, {"$push": {"checklist": item}})
    await audit(user, "checklist_item_added", f"Added checklist item '{input.label}' on {claim_id}")
    return item


@api_router.get("/claims/{claim_id}/sla")
async def get_claim_sla(claim_id: str, user: dict = Depends(current_user)):
    claim = await _load_claim(claim_id, user)
    applicable = {k: v for k, v in SLA_DEFINITIONS.items() if claim["type"] in v["applicable_to"]}
    events = claim.get("sla_events", [])
    return {"applicable": applicable, "events": events}


@api_router.post("/claims/{claim_id}/sla/start")
async def start_claim_sla(claim_id: str, input: SlaStart, user: dict = Depends(current_user)):
    _require_writer(user)
    claim = await _load_claim(claim_id, user)
    definition = SLA_DEFINITIONS.get(input.sla_type)
    if not definition or claim["type"] not in definition["applicable_to"]:
        raise HTTPException(status_code=400, detail=f"This SLA doesn't apply to a {claim['type']} claim")
    started_at = input.started_at or datetime.now(timezone.utc).isoformat()
    event = {
        "id": str(uuid.uuid4()), "sla_type": input.sla_type, "label": definition["label"],
        "hours": definition["hours"], "started_at": started_at, "resolved_at": None,
    }
    await db.claims.update_one({"id": claim_id, "household_id": user["household_id"]}, {"$push": {"sla_events": event}})
    await audit(user, "sla_started", f"Started '{definition['label']}' clock on {claim_id}")
    return event


@api_router.post("/claims/{claim_id}/sla/{event_id}/resolve")
async def resolve_claim_sla(claim_id: str, event_id: str, user: dict = Depends(current_user)):
    _require_writer(user)
    claim = await _load_claim(claim_id, user)
    if not any(e["id"] == event_id for e in claim.get("sla_events", [])):
        raise HTTPException(status_code=404, detail="SLA clock not found")
    resolved_at = datetime.now(timezone.utc).isoformat()
    await db.claims.update_one(
        {"id": claim_id, "household_id": user["household_id"], "sla_events.id": event_id},
        {"$set": {"sla_events.$.resolved_at": resolved_at}},
    )
    await audit(user, "sla_resolved", f"Resolved an SLA clock on {claim_id}")
    return {"id": event_id, "resolved_at": resolved_at}


@api_router.post("/claims")
async def create_claim(input: ClaimCreate, user: dict = Depends(current_user)):
    if user.get("role") == "agent" or user.get("status") == "revoked":
        raise HTTPException(status_code=403, detail="Read-only agents cannot create claims")
    if input.policy_id:
        policy_exists = await db.policies.find_one({"id": input.policy_id, "household_id": user["household_id"]}, {"_id": 0, "id": 1})
        if not policy_exists:
            raise HTTPException(status_code=404, detail="That policy wasn't found in your household")
    now = datetime.now(timezone.utc).isoformat()
    claim = {
        "id": f"CLM-{datetime.now(timezone.utc).year}-{secrets.randbelow(900) + 100}",
        "title": input.title, "type": input.claim_type, "policy_id": input.policy_id,
        "stage": "Claim started", "progress": 8, "amount": "₹0", "updated": "Created just now",
        "status": "in_progress",
        "notes": [], "queries": [], "settlements": [],
        "stage_history": [{"stage": "Claim started", "progress": 8, "note": "", "at": now, "by": user.get("name", "")}],
        "household_id": user["household_id"], "created_by": user["id"], "created_at": now,
    }
    await db.claims.insert_one(claim)
    await audit(user, "claim_created", f"Created {input.claim_type.lower()} claim {claim['id']}")
    return _public_claim(claim)


def _public_claim(claim: dict) -> dict:
    return {k: v for k, v in claim.items() if k not in ("_id", "household_id", "created_by", "created_at")}


def _require_writer(user: dict):
    if user.get("role") == "agent" or user.get("status") == "revoked":
        raise HTTPException(status_code=403, detail="Read-only agents cannot edit claims")


async def _load_claim(claim_id: str, user: dict) -> dict:
    claim = await db.claims.find_one({"id": claim_id, "household_id": user["household_id"]}, {"_id": 0})
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    return claim


@api_router.get("/claims/{claim_id}")
async def get_claim(claim_id: str, user: dict = Depends(current_user)):
    claim = await _load_claim(claim_id, user)
    return _public_claim(claim)


@api_router.post("/claims/{claim_id}/notes")
async def add_note(claim_id: str, input: NoteInput, user: dict = Depends(current_user)):
    _require_writer(user)
    claim = await _load_claim(claim_id, user)
    note = {"id": str(uuid.uuid4()), "text": input.text, "author": user.get("name", ""), "author_id": user["id"], "at": datetime.now(timezone.utc).isoformat()}
    await db.claims.update_one({"id": claim_id, "household_id": user["household_id"]}, {"$push": {"notes": note}, "$set": {"updated": "Note added just now"}})
    await audit(user, "note_added", f"Added a note on {claim_id}")
    return note


@api_router.post("/claims/{claim_id}/queries")
async def add_query(claim_id: str, input: QueryInput, user: dict = Depends(current_user)):
    _require_writer(user)
    await _load_claim(claim_id, user)
    query = {"id": str(uuid.uuid4()), "question": input.question, "source": input.source, "status": "open", "response": None, "logged_by": user.get("name", ""), "at": datetime.now(timezone.utc).isoformat()}
    await db.claims.update_one({"id": claim_id, "household_id": user["household_id"]}, {"$push": {"queries": query}, "$set": {"updated": "Insurer query logged"}})
    await audit(user, "query_logged", f"Logged insurer query on {claim_id}")
    return query


@api_router.post("/claims/{claim_id}/queries/{query_id}/respond")
async def respond_query(claim_id: str, query_id: str, input: QueryResponse, user: dict = Depends(current_user)):
    _require_writer(user)
    result = await db.claims.update_one(
        {"id": claim_id, "household_id": user["household_id"], "queries.id": query_id},
        {"$set": {"queries.$.response": input.response, "queries.$.status": "answered", "queries.$.responded_by": user.get("name", ""), "queries.$.responded_at": datetime.now(timezone.utc).isoformat(), "updated": "Insurer query answered"}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Query not found")
    await audit(user, "query_answered", f"Answered a query on {claim_id}")
    return {"ok": True}


@api_router.post("/claims/{claim_id}/settlements")
async def add_settlement(claim_id: str, input: SettlementInput, user: dict = Depends(current_user)):
    _require_writer(user)
    await _load_claim(claim_id, user)
    entry = {"id": str(uuid.uuid4()), "amount": input.amount, "kind": input.kind, "note": input.note, "recorded_by": user.get("name", ""), "at": datetime.now(timezone.utc).isoformat()}
    update = {"$push": {"settlements": entry}, "$set": {"updated": f"{input.kind.title()} settlement recorded"}}
    if input.kind == "final":
        update["$set"]["status"] = "settled"
    await db.claims.update_one({"id": claim_id, "household_id": user["household_id"]}, update)
    await audit(user, "settlement_recorded", f"Recorded {input.kind} settlement of ₹{int(input.amount):,} on {claim_id}")
    return entry


@api_router.post("/claims/{claim_id}/stage")
async def advance_stage(claim_id: str, input: StageInput, user: dict = Depends(current_user)):
    _require_writer(user)
    await _load_claim(claim_id, user)
    now = datetime.now(timezone.utc).isoformat()
    entry = {"stage": input.stage, "progress": input.progress, "note": input.note, "at": now, "by": user.get("name", "")}
    await db.claims.update_one(
        {"id": claim_id, "household_id": user["household_id"]},
        {"$push": {"stage_history": entry}, "$set": {"stage": input.stage, "progress": input.progress, "updated": "Stage updated"}},
    )
    await audit(user, "stage_advanced", f"{claim_id} moved to '{input.stage}'")
    return entry


@api_router.post("/claims/{claim_id}/status")
async def change_status(claim_id: str, input: StatusInput, user: dict = Depends(current_user)):
    _require_writer(user)
    await _load_claim(claim_id, user)
    now = datetime.now(timezone.utc).isoformat()
    labels = {"rejected": "Rejected", "appealed": "Appeal filed", "reopened": "Reopened", "settled": "Settled"}
    entry = {"stage": labels[input.status], "progress": 100 if input.status in ("rejected", "settled") else 55, "note": input.reason, "at": now, "by": user.get("name", "")}
    await db.claims.update_one(
        {"id": claim_id, "household_id": user["household_id"]},
        {"$push": {"stage_history": entry}, "$set": {"status": input.status, "stage": labels[input.status], "progress": entry["progress"], "updated": f"Marked {input.status}"}},
    )
    await audit(user, f"claim_{input.status}", f"{claim_id} marked {input.status}" + (f": {input.reason}" if input.reason else ""))
    return {"ok": True, "status": input.status}


@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    checks = await db.status_checks.find({}, {"_id": 0}).to_list(1000)
    for check in checks:
        if isinstance(check["timestamp"], str):
            check["timestamp"] = datetime.fromisoformat(check["timestamp"])
    return checks


@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    obj = StatusCheck(**input.model_dump())
    doc = obj.model_dump()
    doc["timestamp"] = doc["timestamp"].isoformat()
    await db.status_checks.insert_one(doc)
    return obj


app.include_router(api_router)
configured_origins = [origin.strip() for origin in os.environ.get("CORS_ORIGINS", "").split(",") if origin.strip() and origin.strip() != "*"]
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=configured_origins, allow_origin_regex=r"http://localhost(:\d+)?", allow_methods=["*"], allow_headers=["*"])

@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.claims.create_index("household_id")
    await db.login_attempts.create_index("identifier", unique=True)
    await db.household_invites.create_index("token", unique=True)
    await db.household_invites.create_index([("household_id", 1), ("email", 1), ("status", 1)])
    await db.audit_events.create_index([("household_id", 1), ("created_at", -1)])
    await db.rate_limits.create_index("key", unique=True)
    await db.policies.create_index("household_id")
    await db.evidence.create_index("household_id")
    await db.documents.create_index("household_id")
    await db.documents.create_index("linked_claim_id")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()