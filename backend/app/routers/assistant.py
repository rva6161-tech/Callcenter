"""Voice assistant routes (Voice Phase A).

Exposes the non-secret ElevenLabs agent id to authenticated clients and mints
short-lived signed WebSocket URLs so the browser can connect to the agent
WITHOUT ever seeing the ElevenLabs API key.

READ-ONLY feature: no data is created, edited, or deleted here.
"""
import os

import requests
from fastapi import APIRouter, Depends, HTTPException, status

from ..assistant_config import ELEVENLABS_AGENT_ID
from ..models import User
from ..security import get_current_user

router = APIRouter(prefix="/api/assistant", tags=["assistant"])

ELEVENLABS_BASE = "https://api.elevenlabs.io"


def _require_api_key() -> str:
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        # Misconfiguration — surface as a server error, never leak details.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Voice assistant is not configured",
        )
    return key


@router.get("/config")
def assistant_config(current_user: User = Depends(get_current_user)):
    """Return the (non-secret) agent id the frontend should connect to."""
    return {"agent_id": ELEVENLABS_AGENT_ID}


@router.post("/signed-url")
def assistant_signed_url(current_user: User = Depends(get_current_user)):
    """Mint a short-lived ElevenLabs signed URL for the browser.

    The API key is sent only server-to-server and is never returned or logged.
    """
    api_key = _require_api_key()
    try:
        resp = requests.get(
            f"{ELEVENLABS_BASE}/v1/convai/conversation/get-signed-url",
            params={"agent_id": ELEVENLABS_AGENT_ID},
            headers={"xi-api-key": api_key},
            timeout=15,
        )
    except requests.RequestException:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not reach the voice assistant service",
        )

    if resp.status_code != 200:
        # Do not echo the upstream body — it could contain sensitive detail.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not obtain a signed URL from the voice assistant service",
        )

    signed_url = resp.json().get("signed_url")
    if not signed_url:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Voice assistant service returned no signed URL",
        )

    return {"signed_url": signed_url}
