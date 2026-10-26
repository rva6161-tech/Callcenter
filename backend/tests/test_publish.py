"""Publishing + the agent-facing my-schedule view (Phase 4)."""
from datetime import timedelta

import pytest
from sqlalchemy import text

from conftest import TEAM1_ID, WK_PUBLISH, auth_headers, AGENT_TEAM1_EMAIL

MORNING = 1


@pytest.fixture
def agent_id(db):
    """The id of the agent whose credentials `agent_headers` logs in as."""
    row = db.execute(
        text("SELECT id FROM bw_callcenter_1.users WHERE email = :e"),
        {"e": AGENT_TEAM1_EMAIL},
    ).fetchone()
    return row[0]


def test_publish_flow_and_agent_view(client, admin_headers, registry, agent_id):
    registry.week(TEAM1_ID, WK_PUBLISH)
    mon = WK_PUBLISH

    # Admin assigns the agent a Monday shift (draft week created implicitly).
    r = client.put(
        "/api/schedule/assignment",
        json={
            "team_id": TEAM1_ID,
            "week_start": mon.isoformat(),
            "agent_id": agent_id,
            "work_date": mon.isoformat(),
            "shift_type_id": MORNING,
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text

    agent_h = auth_headers(client, AGENT_TEAM1_EMAIL)

    # Before publish: agent sees nothing (draft must not leak).
    r = client.get(
        "/api/my-schedule", params={"week_start": mon.isoformat()}, headers=agent_h
    )
    assert r.status_code == 200
    assert r.json()["published"] is False
    assert r.json()["shifts"] == []

    # Publish.
    r = client.post(
        "/api/schedule/publish",
        json={"team_id": TEAM1_ID, "week_start": mon.isoformat()},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "published"

    # After publish: agent sees the published shift.
    r = client.get(
        "/api/my-schedule", params={"week_start": mon.isoformat()}, headers=agent_h
    )
    assert r.status_code == 200
    body = r.json()
    assert body["published"] is True
    assert len(body["shifts"]) == 1
    assert body["shifts"][0]["work_date"] == mon.isoformat()
    assert body["shifts"][0]["shift_type"]["id"] == MORNING

    # Unpublish -> agent view empties again.
    r = client.post(
        "/api/schedule/unpublish",
        json={"team_id": TEAM1_ID, "week_start": mon.isoformat()},
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json()["status"] == "draft"

    r = client.get(
        "/api/my-schedule", params={"week_start": mon.isoformat()}, headers=agent_h
    )
    assert r.json()["published"] is False
    assert r.json()["shifts"] == []


def test_agent_cannot_publish(client, registry):
    agent_h = auth_headers(client, AGENT_TEAM1_EMAIL)
    r = client.post(
        "/api/schedule/publish",
        json={"team_id": TEAM1_ID, "week_start": WK_PUBLISH.isoformat()},
        headers=agent_h,
    )
    assert r.status_code == 403
