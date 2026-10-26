#!/usr/bin/env python3
"""Idempotently provision the Callcenter ElevenLabs Conversational AI agent.

Voice Phase A — a READ-ONLY voice copilot for the staff-scheduling app.

What this script does:
  1. Looks for an agent named "Callcenter Voice Assistant"; reuses it if present,
     otherwise creates it (no duplicates on re-run).
  2. Picks a clear English TTS voice (prefers "Rachel", falls back sensibly).
  3. Creates the agent with the system prompt + six CLIENT tools below, using
     ElevenLabs' built-in default LLM (no custom LLM wiring).
  4. Marks the agent PRIVATE (authentication enabled) so it is only reachable
     via a short-lived signed URL, never anonymously.
  5. Writes the resulting agent_id to backend/app/assistant_config.py so the
     FastAPI backend can read it. The agent_id is NOT a secret.

Run it with the backend venv:
    /home/ubuntu/app/backend/venv/bin/python backend/scripts/setup_elevenlabs_agent.py

ELEVENLABS_API_KEY is read from the environment and never written to disk.
"""
import os
import sys

import requests

ELEVENLABS_BASE = "https://api.elevenlabs.io"
AGENT_NAME = "Callcenter Voice Assistant"

# Clear, professional English voices in order of preference (matched by first
# name, case-insensitive). If none are present we fall back to the first voice.
VOICE_PREFERENCES = ["Rachel", "Sarah", "Alice", "Matilda", "Bella", "Jessica"]

# Built-in default LLM offered by ElevenLabs (no custom LLM wiring).
DEFAULT_LLM = "claude-haiku-4-5"

SYSTEM_PROMPT = (
    "You are the Callcenter Scheduling voice assistant. You help the user "
    "navigate a staff-scheduling web app and answer questions about teams, "
    "agents, and weekly shift schedules. You are READ-ONLY: you can look things "
    "up and move around the app, but you never create, edit, delete, or publish "
    "anything — if asked to change data, politely say that's not supported "
    "yet. To show the user where things are, use the navigate and highlight "
    "tools to drive the on-screen UI as you talk. Use get_teams, get_team, "
    "get_schedule, and get_my_schedule to fetch live data before answering. "
    "Keep spoken replies short and natural. Roles: admins see everything, "
    "supervisors see only their own team, agents see only their own published "
    "shifts — never imply access beyond the user's role."
)

FIRST_MESSAGE = (
    "Hi, I'm your Callcenter scheduling assistant. I can show you teams, agents, "
    "and weekly shift schedules — where would you like to start?"
)

CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "app",
    "assistant_config.py",
)


def _client_tool(name, description, properties, required, expects_response):
    """Build an inline CLIENT tool definition for conversation_config."""
    return {
        "type": "client",
        "name": name,
        "description": description,
        "parameters": {
            "type": "object",
            "required": required,
            "properties": properties,
        },
        "expects_response": expects_response,
    }


def _string(description):
    return {"type": "string", "description": description}


def _integer(description):
    return {"type": "integer", "description": description}


# The six READ-ONLY client tools. navigate/highlight drive the UI (no response
# expected); the get_* tools fetch live data (response expected).
CLIENT_TOOLS = [
    _client_tool(
        "navigate",
        "Move the on-screen UI to a destination so the user sees what you are "
        "talking about. destination must be one of: home, teams, team_detail, "
        "schedule, shift_types, my_schedule. Pass team_name when the destination "
        "concerns a specific team (team_detail or schedule). Pass week_offset "
        "(0 = current week, 1 = next, -1 = previous) for schedule views.",
        {
            "destination": _string(
                "One of: home, teams, team_detail, schedule, shift_types, "
                "my_schedule."
            ),
            "team_name": _string("The team to focus on, when relevant."),
            "week_offset": _integer(
                "Week relative to the current week (0=this week, 1=next, -1=last)."
            ),
        },
        required=["destination"],
        expects_response=False,
    ),
    _client_tool(
        "highlight",
        "Visually highlight an element on the current screen so the user can see "
        "exactly what you mean.",
        {"target": _string("Identifier or label of the UI element to highlight.")},
        required=["target"],
        expects_response=False,
    ),
    _client_tool(
        "get_teams",
        "Fetch the list of teams the current user is allowed to see. Call this "
        "before answering questions about which teams exist.",
        {},
        required=[],
        expects_response=True,
    ),
    _client_tool(
        "get_team",
        "Fetch details for a single team (its supervisor and agents).",
        {"team_name": _string("The name of the team to look up.")},
        required=["team_name"],
        expects_response=True,
    ),
    _client_tool(
        "get_schedule",
        "Fetch a team's weekly shift schedule for a given week.",
        {
            "team_name": _string("The name of the team whose schedule to fetch."),
            "week_offset": _integer(
                "Week relative to the current week (0=this week, 1=next, -1=last)."
            ),
        },
        required=["team_name"],
        expects_response=True,
    ),
    _client_tool(
        "get_my_schedule",
        "Fetch the current user's own published shifts for a given week.",
        {
            "week_offset": _integer(
                "Week relative to the current week (0=this week, 1=next, -1=last)."
            )
        },
        required=[],
        expects_response=True,
    ),
]


def _session(api_key):
    s = requests.Session()
    s.headers.update({"xi-api-key": api_key, "Content-Type": "application/json"})
    return s


def find_existing_agent(session):
    """Return the agent_id of an existing agent named AGENT_NAME, or None."""
    resp = session.get(
        f"{ELEVENLABS_BASE}/v1/convai/agents", params={"page_size": 100}, timeout=30
    )
    resp.raise_for_status()
    for agent in resp.json().get("agents", []):
        if agent.get("name") == AGENT_NAME:
            return agent["agent_id"]
    return None


def pick_voice(session):
    """Return (voice_id, voice_name) for a clear English voice."""
    resp = session.get(f"{ELEVENLABS_BASE}/v1/voices", timeout=30)
    resp.raise_for_status()
    voices = resp.json().get("voices", [])
    if not voices:
        raise RuntimeError("No voices available on this ElevenLabs account.")

    by_first_name = {}
    for v in voices:
        first = v["name"].split()[0].lower()
        by_first_name.setdefault(first, v)

    for pref in VOICE_PREFERENCES:
        match = by_first_name.get(pref.lower())
        if match:
            return match["voice_id"], match["name"]

    first = voices[0]
    return first["voice_id"], first["name"]


def build_config(voice_id):
    return {
        "name": AGENT_NAME,
        "conversation_config": {
            "agent": {
                "language": "en",
                "first_message": FIRST_MESSAGE,
                "prompt": {
                    "prompt": SYSTEM_PROMPT,
                    "llm": DEFAULT_LLM,
                    "tools": CLIENT_TOOLS,
                },
            },
            "tts": {"voice_id": voice_id},
        },
        # Private agent: authentication enabled means a conversation can only be
        # started with a signed URL / token, never anonymously. No origin
        # allowlist so our own backend-minted signed URLs are accepted.
        "platform_settings": {
            "auth": {
                "enable_auth": True,
                "allowlist": [],
                "require_origin_header": False,
            }
        },
    }


def create_agent(session, voice_id):
    resp = session.post(
        f"{ELEVENLABS_BASE}/v1/convai/agents/create",
        json=build_config(voice_id),
        timeout=60,
    )
    if resp.status_code != 200:
        raise RuntimeError(
            f"Agent create failed ({resp.status_code}): {resp.text[:500]}"
        )
    return resp.json()["agent_id"]


def write_config_constant(agent_id):
    content = (
        '"""Non-secret ElevenLabs config, written by '
        "scripts/setup_elevenlabs_agent.py.\n\n"
        "The agent_id is NOT a secret; it only identifies which Conversational AI\n"
        "agent the frontend should connect to. The API key is never stored here.\n"
        '"""\n'
        f'ELEVENLABS_AGENT_ID = "{agent_id}"\n'
    )
    with open(CONFIG_PATH, "w") as fh:
        fh.write(content)


def main():
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        print("ERROR: ELEVENLABS_API_KEY is not set in the environment.", file=sys.stderr)
        sys.exit(1)

    session = _session(api_key)

    voice_id, voice_name = pick_voice(session)
    print(f"Chosen voice: {voice_name} ({voice_id})")

    existing = find_existing_agent(session)
    if existing:
        agent_id = existing
        print(f"Reusing existing agent '{AGENT_NAME}': {agent_id} (no duplicate created)")
    else:
        agent_id = create_agent(session, voice_id)
        print(f"Created agent '{AGENT_NAME}': {agent_id}")

    write_config_constant(agent_id)
    print(f"Wrote ELEVENLABS_AGENT_ID to {CONFIG_PATH}")
    print(f"AGENT_ID={agent_id}")
    print(f"VOICE={voice_name}")


if __name__ == "__main__":
    main()
