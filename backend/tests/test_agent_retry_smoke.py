import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from unittest.mock import patch, MagicMock
from conftest import make_policy

def test_agent_ask_retries_once_on_503_then_succeeds(registered_user, monkeypatch):
    """Reproduces the exact real production scenario from the logs: Gemini
    returns a 503 'high demand' error, which should be retried once and
    succeed, rather than failing outright."""
    client, user = registered_user
    import server as srv
    from google.genai import errors as genai_errors
    monkeypatch.setattr(srv, "GEMINI_API_KEY", "fake-key")
    srv.time.sleep = lambda s: None
    make_policy(client, insurer_name="Star Health")

    class FakeResponse:
        text = "Your Star Health policy is active."

    call_count = {"n": 0}

    def side_effect(*a, **kw):
        call_count["n"] += 1
        if call_count["n"] < 2:
            raise genai_errors.ServerError(503, {"error": {"code": 503, "message": "high demand", "status": "UNAVAILABLE"}})
        return FakeResponse()

    with patch("server.genai.Client") as MockClient:
        mock_instance = MagicMock()
        mock_instance.models.generate_content.side_effect = side_effect
        MockClient.return_value = mock_instance
        r = client.post("/api/agent/ask", json={"message": "Is my policy active?"})
        assert r.status_code == 200, r.text
        assert r.json()["answer"] == "Your Star Health policy is active."
        assert call_count["n"] == 2
        print("Correctly retried once on 503 and succeeded, matching the real production scenario")

def test_agent_ask_fails_cleanly_after_max_retries(registered_user, monkeypatch):
    client, user = registered_user
    import server as srv
    from google.genai import errors as genai_errors
    monkeypatch.setattr(srv, "GEMINI_API_KEY", "fake-key")
    srv.time.sleep = lambda s: None

    def side_effect(*a, **kw):
        raise genai_errors.ServerError(503, {"error": {"code": 503, "message": "high demand", "status": "UNAVAILABLE"}})

    with patch("server.genai.Client") as MockClient:
        mock_instance = MagicMock()
        mock_instance.models.generate_content.side_effect = side_effect
        MockClient.return_value = mock_instance
        r = client.post("/api/agent/ask", json={"message": "hello"})
        assert r.status_code == 502
