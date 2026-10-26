"""Schedule engine — the critical logic.

All tests run on FUTURE weeks (2027) using seeded team 1 (Billing) agents, and
register their created weeks for teardown so the seeded data is untouched.

Seeded shift types: Morning=1 (07:00-15:00), Mid=2 (11:00-19:00),
Evening=3 (15:00-23:00), Night=4 (23:00-07:00 overnight).
"""
from datetime import timedelta

import pytest
from sqlalchemy import text

from conftest import (
    TEAM1_ID,
    WK_COPY_DST,
    WK_COPY_SRC,
    WK_COUNTS,
    WK_OVERLAP,
    WK_REST,
    WK_UPSERT,
)

MORNING, MID, EVENING, NIGHT = 1, 2, 3, 4


@pytest.fixture
def team1_agents(db):
    """Two seeded team-1 agent ids (stable), looked up live."""
    rows = db.execute(
        text(
            "SELECT id FROM bw_callcenter_1.users "
            "WHERE team_id = :t AND role = 'agent' ORDER BY id LIMIT 2"
        ),
        {"t": TEAM1_ID},
    ).fetchall()
    return [r[0] for r in rows]


def _upsert(client, headers, team_id, week_start, agent_id, work_date,
            shift_type_id=None, is_day_off=False):
    return client.put(
        "/api/schedule/assignment",
        json={
            "team_id": team_id,
            "week_start": week_start.isoformat(),
            "agent_id": agent_id,
            "work_date": work_date.isoformat(),
            "shift_type_id": shift_type_id,
            "is_day_off": is_day_off,
        },
        headers=headers,
    )


# --------------------------------------------------------------------------- #
# Upsert + day-off + delete
# --------------------------------------------------------------------------- #
def test_assign_upsert_day_off_and_delete(client, admin_headers, registry, team1_agents):
    registry.week(TEAM1_ID, WK_UPSERT)
    agent = team1_agents[0]
    mon = WK_UPSERT

    # Create a real shift -> 201.
    r = _upsert(client, admin_headers, TEAM1_ID, mon, agent, mon, MORNING)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["shift_type_id"] == MORNING
    assert body["is_day_off"] is False
    assignment_id = body["id"]

    # Upsert same cell to a different shift -> 200 (updated, not duplicated).
    r = _upsert(client, admin_headers, TEAM1_ID, mon, agent, mon, EVENING)
    assert r.status_code == 200, r.text
    assert r.json()["id"] == assignment_id
    assert r.json()["shift_type_id"] == EVENING

    # Mark a day off (shift_type_id null) on Tuesday.
    tue = mon + timedelta(days=1)
    r = _upsert(client, admin_headers, TEAM1_ID, mon, agent, tue, is_day_off=True)
    assert r.status_code == 201, r.text
    assert r.json()["is_day_off"] is True
    assert r.json()["shift_type_id"] is None

    # Delete the Monday assignment -> 204.
    r = client.delete(
        f"/api/schedule/assignment/{assignment_id}", headers=admin_headers
    )
    assert r.status_code == 204

    # Deleting again -> 404.
    r = client.delete(
        f"/api/schedule/assignment/{assignment_id}", headers=admin_headers
    )
    assert r.status_code == 404


# --------------------------------------------------------------------------- #
# Overlap is blocked with 409
# --------------------------------------------------------------------------- #
def test_overlap_blocked_409(client, admin_headers, registry, team1_agents):
    registry.week(TEAM1_ID, WK_OVERLAP)
    agent = team1_agents[0]
    mon = WK_OVERLAP
    tue = mon + timedelta(days=1)

    # A custom early shift (06:00-14:00) so it overlaps the overnight Night that
    # runs until 07:00 the next morning. Registered for cleanup.
    r = client.post(
        "/api/shift-types",
        json={"name": "QA Early Overlap", "start_time": "06:00", "end_time": "14:00"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    early_id = r.json()["id"]
    registry.shift_type(early_id)

    # Night on Monday 23:00 -> Tuesday 07:00.
    r = _upsert(client, admin_headers, TEAM1_ID, mon, agent, mon, NIGHT)
    assert r.status_code == 201, r.text

    # Early shift Tuesday 06:00 -> overlaps the Night's 07:00 tail -> 409.
    r = _upsert(client, admin_headers, TEAM1_ID, mon, agent, tue, early_id)
    assert r.status_code == 409, r.text
    assert "overlap" in r.json()["detail"].lower()

    # And the overlapping cell must NOT have been saved.
    grid = client.get(
        "/api/schedule",
        params={"team_id": TEAM1_ID, "week_start": mon.isoformat()},
        headers=admin_headers,
    ).json()
    tue_cells = [a for a in grid["assignments"] if a["work_date"] == tue.isoformat()]
    assert tue_cells == []


# --------------------------------------------------------------------------- #
# Rest warning for < 11h gap (non-blocking)
# --------------------------------------------------------------------------- #
def test_rest_warning_under_11h(client, admin_headers, registry, team1_agents):
    registry.week(TEAM1_ID, WK_REST)
    agent = team1_agents[0]
    mon = WK_REST
    tue = mon + timedelta(days=1)

    # Night Monday ends Tuesday 07:00; Morning Tuesday starts 07:00 -> 0h rest.
    r = _upsert(client, admin_headers, TEAM1_ID, mon, agent, mon, NIGHT)
    assert r.status_code == 201, r.text
    assert r.json()["warnings"] == []

    r = _upsert(client, admin_headers, TEAM1_ID, mon, agent, tue, MORNING)
    assert r.status_code in (200, 201), r.text
    warnings = r.json()["warnings"]
    assert warnings, "expected a low-rest warning for the <11h gap"
    assert "rest" in warnings[0].lower()


# --------------------------------------------------------------------------- #
# day_counts correct
# --------------------------------------------------------------------------- #
def test_day_counts(client, admin_headers, registry, team1_agents):
    registry.week(TEAM1_ID, WK_COUNTS)
    a1, a2 = team1_agents[0], team1_agents[1]
    mon = WK_COUNTS
    tue = mon + timedelta(days=1)

    assert _upsert(client, admin_headers, TEAM1_ID, mon, a1, mon, MORNING).status_code == 201
    assert _upsert(client, admin_headers, TEAM1_ID, mon, a2, mon, MID).status_code == 201
    # A day off on Tuesday must NOT count toward the day's staffing.
    assert _upsert(client, admin_headers, TEAM1_ID, mon, a1, tue, is_day_off=True).status_code == 201

    grid = client.get(
        "/api/schedule",
        params={"team_id": TEAM1_ID, "week_start": mon.isoformat()},
        headers=admin_headers,
    ).json()
    assert grid["day_counts"][mon.isoformat()] == 2
    assert grid["day_counts"][tue.isoformat()] == 0


# --------------------------------------------------------------------------- #
# copy-last-week copies the prior week
# --------------------------------------------------------------------------- #
def test_copy_last_week(client, admin_headers, registry, team1_agents):
    registry.week(TEAM1_ID, WK_COPY_SRC)
    registry.week(TEAM1_ID, WK_COPY_DST)
    a1, a2 = team1_agents[0], team1_agents[1]
    src = WK_COPY_SRC
    src_tue = src + timedelta(days=1)

    # Seed the source week with two shifts.
    assert _upsert(client, admin_headers, TEAM1_ID, src, a1, src, MORNING).status_code == 201
    assert _upsert(client, admin_headers, TEAM1_ID, src, a2, src_tue, EVENING).status_code == 201

    # Copy into the following week.
    r = client.post(
        "/api/schedule/copy-last-week",
        json={"team_id": TEAM1_ID, "week_start": WK_COPY_DST.isoformat()},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 2

    # The destination week now mirrors the source (shifted +7 days).
    grid = client.get(
        "/api/schedule",
        params={"team_id": TEAM1_ID, "week_start": WK_COPY_DST.isoformat()},
        headers=admin_headers,
    ).json()
    cells = {(a["agent_id"], a["work_date"]): a["shift_type_id"]
             for a in grid["assignments"]}
    assert cells[(a1, WK_COPY_DST.isoformat())] == MORNING
    assert cells[(a2, (WK_COPY_DST + timedelta(days=1)).isoformat())] == EVENING


# --------------------------------------------------------------------------- #
# Validation guards
# --------------------------------------------------------------------------- #
def test_non_monday_week_start_400(client, admin_headers, team1_agents):
    tuesday = WK_UPSERT + timedelta(days=1)
    r = client.get(
        "/api/schedule",
        params={"team_id": TEAM1_ID, "week_start": tuesday.isoformat()},
        headers=admin_headers,
    )
    assert r.status_code == 400


def test_copy_last_week_nothing_to_copy(client, admin_headers, registry):
    # A future week with no prior week -> created 0, nothing persisted.
    far = WK_COUNTS + timedelta(days=364)  # distinct, empty; snap handled below
    far = far - timedelta(days=far.weekday())
    registry.week(TEAM1_ID, far)
    r = client.post(
        "/api/schedule/copy-last-week",
        json={"team_id": TEAM1_ID, "week_start": far.isoformat()},
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json()["created"] == 0
