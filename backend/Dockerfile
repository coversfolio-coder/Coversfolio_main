FROM python:3.11-slim

WORKDIR /app

# A stale CA certificate bundle in the base image is a documented cause of TLS
# handshake failures against MongoDB Atlas specifically - refreshing it at
# build time costs nothing and rules out an entire class of "SSL handshake
# failed" errors that have nothing to do with the app's own code.
RUN apt-get update && apt-get install --no-install-recommends -y ca-certificates && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Tesseract is the offline OCR fallback used when Gemini isn't configured or
# fails - keeps document/receipt text extraction working even without an AI
# key or if the AI provider has an outage. tesseract-ocr's Debian package
# already bundles the English language data, so no separate language-pack
# package is needed for the primary use case (Indian insurance/receipt
# documents are predominantly English or English-numeral).
RUN apt-get update && apt-get install --no-install-recommends -y tesseract-ocr && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/storage

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
