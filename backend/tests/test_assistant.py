"""Tests for the Voice Assistant routes (app/routers/assistant.py).

Covers:
  * GET  /api/assistant/config      — agent id for any authenticated user, 401 w/o token.
  * POST /api/assistant/signed-url  — mints an ElevenLabs signed URL server-side.
  * SECRET-LEAK GUARD — the ELEVENLABS_API_KEY must never appear in any response
    body, and no response key may be named like an api key.
  * Role access — an agent (lowest role) can still use both endpoints.

Notes:
  * signed-url makes a REAL upstream call to ElevenLabs. If the upstream is
    unreachable in the test env it may return 502/503, so status is asserted to
    be in (200, 502, 503); the signed_url shape is only checked on 200.
"""
import os


SECRET_KEYS = {"api_key", "apikey", "xi_api_key", "xi-api-key", "elevenlabs_api_key"}


def _assert_no_secret_leak(resp):
    """Fail if the live API key, or any api-key-ish field, is present."""
    api_key = os.environ["ELEVENLABS_API_KEY"]
    body_text = resp.text
    assert api_key not in body_text, "ELEVENLABS_API_KEY leaked into response body!"
    try:
        data = resp.json()
    except ValueError:
        return
    if isinstance(data, dict):
        for key in data:
            assert key.lower() not in SECRET_KEYS, f"suspicious api-key field '{key}' in response"
            # Value of any field must not equal the secret either.
            assert data[key] != api_key, f"field '{key}' contains the raw API key"


# --------------------------------------------------------------------------- #
# GET /api/assistant/config
# --------------------------------------------------------------------------- #
def test_config_returns_agent_id_for_admin(client, admin_headers):
    resp = client.get("/api/assistant/config", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert isinstance(data.get("agent_id"), str) and data["agent_id"], "agent_id empty"
    _assert_no_secret_leak(resp)


def test_config_allowed_for_supervisor(client, sup1_headers):
    resp = client.get("/api/assistant/config", headers=sup1_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["agent_id"]


def test_config_allowed_for_agent(client, agent_headers):
    # Agent is the lowest role; config must NOT be 403 for them.
    resp = client.get("/api/assistant/config", headers=agent_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["agent_id"]
    _assert_no_secret_leak(resp)


def test_config_requires_auth(client):
    resp = client.get("/api/assistant/config")
    assert resp.status_code == 401


# --------------------------------------------------------------------------- #
# POST /api/assistant/signed-url
# --------------------------------------------------------------------------- #
def test_signed_url_for_authenticated_user(client, admin_headers):
    resp = client.post("/api/assistant/signed-url", headers=admin_headers)
    assert resp.status_code in (200, 502, 503), resp.text
    if resp.status_code == 200:
        signed_url = resp.json().get("signed_url")
        assert isinstance(signed_url, str) and signed_url.startswith("wss://"), signed_url
    # Regardless of upstream outcome, no secret may ever leak.
    _assert_no_secret_leak(resp)


def test_signed_url_allowed_for_agent(client, agent_headers):
    # Any authenticated role may mint a signed URL — not 403.
    resp = client.post("/api/assistant/signed-url", headers=agent_headers)
    assert resp.status_code != 403
    assert resp.status_code in (200, 502, 503), resp.text
    if resp.status_code == 200:
        assert resp.json()["signed_url"].startswith("wss://")
    _assert_no_secret_leak(resp)


def test_signed_url_requires_auth(client):
    resp = client.post("/api/assistant/signed-url")
    assert resp.status_code == 401
    _assert_no_secret_leak(resp)
