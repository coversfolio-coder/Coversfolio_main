import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import asyncio
from unittest.mock import patch, MagicMock


class FakePart:
    def __init__(self, text=None, function_call=None):
        self.text = text
        self.function_call = function_call


class FakeFunctionCall:
    def __init__(self, name, args):
        self.name = name
        self.args = args


class FakeContent:
    def __init__(self, parts):
        self.parts = parts


class FakeCandidate:
    def __init__(self, parts):
        self.content = FakeContent(parts)


class FakeResponse:
    """Mimics the real shape ask_agent_with_gemini actually reads:
    response.text for the plain-text shortcut, and
    response.candidates[0].content.parts[i].function_call for tool calls."""
    def __init__(self, text=None, function_calls=None):
        self.text = text
        if function_calls:
            parts = [FakePart(function_call=FakeFunctionCall(fc["name"], fc["args"])) for fc in function_calls]
        else:
            parts = [FakePart(text=text)]
        self.candidates = [FakeCandidate(parts)]


def _insert_doc(household_id, **overrides):
    import server as srv
    doc = {
        "id": "doc-1", "household_id": household_id, "uploaded_by": "u1",
        "filename": "discharge.pdf", "content_type": "application/pdf", "size": 100,
        "category": "discharge_summary", "bill_amount": None, "bill_date": None,
        "extracted_text": "Patient diagnosed with Acute Appendicitis, discharged 15 Aug 2026.",
        "stored_path": "/tmp/fake", "uploaded_at": "2026-08-15T00:00:00",
    }
    doc.update(overrides)
    asyncio.get_event_loop().run_until_complete(srv.db.documents.insert_one(doc))


def test_agent_ask_includes_document_content_and_uses_function_tools_not_google_search(registered_user, monkeypatch):
    """Direct-answer case: no tool call needed. Confirms document content still
    reaches the context, and that the config now offers the document
    function-calling tools (not google_search directly) on this first call -
    the architecture changed, but grounding in real document content didn't."""
    client, user = registered_user
    import server as srv
    monkeypatch.setattr(srv, "GEMINI_API_KEY", "fake-key")
    _insert_doc(user["household_id"])

    captured = {}

    def side_effect(*a, **kw):
        captured["contents"] = kw.get("contents")
        captured["config"] = kw.get("config")
        return FakeResponse(text="Your discharge summary shows a diagnosis of Acute Appendicitis.")

    with patch("server.genai.Client") as MockClient:
        mock_instance = MagicMock()
        mock_instance.models.generate_content.side_effect = side_effect
        MockClient.return_value = mock_instance
        r = client.post("/api/agent/ask", json={"message": "What was I diagnosed with?"})

    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]
    job = client.get(f"/api/ai-jobs/{job_id}").json()
    assert job["status"] == "done"
    assert "Appendicitis" in job["result"]
    system_instruction = captured["config"].system_instruction
    assert "discharge.pdf" in system_instruction
    assert "Acute Appendicitis" in system_instruction
    assert captured["config"].tools is not None
    assert captured["config"].tools[0].function_declarations is not None
    tool_names = [fd.name for fd in captured["config"].tools[0].function_declarations]
    assert "search_documents" in tool_names
    assert "get_document_text" in tool_names


def test_agent_ask_uses_search_documents_tool(registered_user, monkeypatch):
    """Confirms the function-calling loop actually works: Gemini requests
    search_documents, gets a real result back, then answers using it."""
    client, user = registered_user
    import server as srv
    monkeypatch.setattr(srv, "GEMINI_API_KEY", "fake-key")
    _insert_doc(user["household_id"], filename="old_hospital_bill.pdf", extracted_text="Total billed: Rs 45,000 for cataract surgery.")

    call_log = []

    def side_effect(*a, **kw):
        call_log.append(kw.get("contents"))
        if len(call_log) == 1:
            return FakeResponse(function_calls=[{"name": "search_documents", "args": {"query": "cataract"}}])
        return FakeResponse(text="Your old hospital bill shows Rs 45,000 for cataract surgery.")

    with patch("server.genai.Client") as MockClient:
        mock_instance = MagicMock()
        mock_instance.models.generate_content.side_effect = side_effect
        MockClient.return_value = mock_instance
        r = client.post("/api/agent/ask", json={"message": "How much was my cataract surgery?"})

    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]
    job = client.get(f"/api/ai-jobs/{job_id}").json()
    assert job["status"] == "done"
    assert "45,000" in job["result"]
    assert len(call_log) == 2
    second_call_contents = call_log[1]
    all_text = str(second_call_contents)
    assert "old_hospital_bill.pdf" in all_text


def test_agent_ask_falls_back_to_web_search_when_marker_present(registered_user, monkeypatch):
    """Confirms the NEEDS_WEB_SEARCH marker correctly triggers a SEPARATE
    google_search-only call, followed by a synthesis call - and that the
    final answer clearly attributes the info to a web search."""
    client, user = registered_user
    import server as srv
    monkeypatch.setattr(srv, "GEMINI_API_KEY", "fake-key")

    call_log = []

    def side_effect(*a, **kw):
        call_log.append(kw.get("config"))
        if len(call_log) == 1:
            return FakeResponse(text="NEEDS_WEB_SEARCH: Reliance General claim intimation number format")
        if len(call_log) == 2:
            return FakeResponse(text="Reliance General's claim intimation numbers follow the format CIR/YYYY/XXXXXX/NNNN, per their public claims portal.")
        return FakeResponse(text="I couldn't find this in your documents, so I checked online: Reliance General's claim numbers follow CIR/YYYY/XXXXXX/NNNN.")

    with patch("server.genai.Client") as MockClient:
        mock_instance = MagicMock()
        mock_instance.models.generate_content.side_effect = side_effect
        MockClient.return_value = mock_instance
        r = client.post("/api/agent/ask", json={"message": "What format is a Reliance General claim number?"})

    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]
    job = client.get(f"/api/ai-jobs/{job_id}").json()
    assert job["status"] == "done"
    answer = job["result"]
    assert "checked online" in answer
    assert "CIR/YYYY" in answer
    assert len(call_log) == 3
    search_call_config = call_log[1]
    assert search_call_config.tools[0].google_search is not None
