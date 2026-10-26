"""Shared pytest fixtures for the Callcenter scheduling API test suite.

Design goals (per the test brief):
  * Exercise the REAL routes against the REAL database via FastAPI TestClient.
  * NEVER mutate seeded data permanently. Every test creates its own isolated
    rows (temp teams / users / shift types / FUTURE weeks in 2027) and cleans
    them up, leaving the seed counts intact:
      teams 3, users 21, shift_types 4, shift_assignments 119.
"""
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import SessionLocal
from app.main import app

SEED_PASSWORD = "Password123!"

# --- Seeded identities (looked up / confirmed from the DB) --------------------
ADMIN_EMAIL = "admin@callcenter.test"
SUP_TEAM1_EMAIL = "billing.supervisor@callcenter.test"      # team 1 (Billing)
SUP_TEAM2_EMAIL = "support.supervisor@callcenter.test"      # team 2 (Support)
AGENT_TEAM1_EMAIL = "olivia.martinez@callcenter.test"       # team 1 agent (id 5)

TEAM1_ID = 1
TEAM2_ID = 2


# --------------------------------------------------------------------------- #
# Client + auth helpers
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def login(client, email, password=SEED_PASSWORD):
    """Return the raw login response."""
    return client.post("/api/auth/login", json={"email": email, "password": password})


def auth_headers(client, email, password=SEED_PASSWORD):
    """Log in and return an Authorization header dict."""
    resp = login(client, email, password)
    assert resp.status_code == 200, f"login failed for {email}: {resp.text}"
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.fixture
def admin_headers(client):
    return auth_headers(client, ADMIN_EMAIL)


@pytest.fixture
def sup1_headers(client):
    return auth_headers(client, SUP_TEAM1_EMAIL)


@pytest.fixture
def sup2_headers(client):
    return auth_headers(client, SUP_TEAM2_EMAIL)


@pytest.fixture
def agent_headers(client):
    return auth_headers(client, AGENT_TEAM1_EMAIL)


# --------------------------------------------------------------------------- #
# Date helpers — all test weeks live far in the future (2027) so they can never
# collide with the seeded weeks (2026-10-26 / 2026-11-02).
# --------------------------------------------------------------------------- #
def monday(d: date) -> date:
    """Snap any date back to the Monday of its week."""
    return d - timedelta(days=d.weekday())


# Distinct future Mondays, one per schedule-ish test, to keep them isolated.
WK_UPSERT = monday(date(2027, 3, 1))
WK_OVERLAP = monday(date(2027, 4, 5))
WK_REST = monday(date(2027, 5, 3))
WK_COUNTS = monday(date(2027, 6, 7))
WK_COPY_SRC = monday(date(2027, 7, 5))
WK_COPY_DST = WK_COPY_SRC + timedelta(days=7)
WK_PUBLISH = monday(date(2027, 8, 2))


# --------------------------------------------------------------------------- #
# Direct DB access + cleanup registry
# --------------------------------------------------------------------------- #
@pytest.fixture
def db():
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


def _delete_week(s, team_id, week_start):
    """Delete a (team, week) schedule_week; assignments cascade via FK."""
    s.execute(
        text(
            "DELETE FROM bw_callcenter_1.schedule_weeks "
            "WHERE team_id = :t AND week_start_date = :w"
        ),
        {"t": team_id, "w": week_start},
    )
    s.commit()


class Registry:
    """Tracks rows created by a test so teardown can remove them in FK-safe order."""

    def __init__(self, s):
        self.s = s
        self.weeks = []        # (team_id, week_start)
        self.shift_type_ids = []
        self.user_ids = []
        self.team_ids = []

    def week(self, team_id, week_start):
        self.weeks.append((team_id, week_start))

    def shift_type(self, st_id):
        self.shift_type_ids.append(st_id)

    def user(self, uid):
        self.user_ids.append(uid)

    def team(self, tid):
        self.team_ids.append(tid)

    def cleanup(self):
        s = self.s
        for team_id, wk in self.weeks:
            _delete_week(s, team_id, wk)
        # Any schedule weeks hanging off temp teams.
        for tid in self.team_ids:
            s.execute(
                text("DELETE FROM bw_callcenter_1.schedule_weeks WHERE team_id = :t"),
                {"t": tid},
            )
        # Detach users from temp teams, then clear temp team supervisor pointers.
        for tid in self.team_ids:
            s.execute(
                text("UPDATE bw_callcenter_1.users SET team_id = NULL WHERE team_id = :t"),
                {"t": tid},
            )
            s.execute(
                text("UPDATE bw_callcenter_1.teams SET supervisor_id = NULL WHERE id = :t"),
                {"t": tid},
            )
        s.commit()
        for uid in self.user_ids:
            s.execute(
                text("DELETE FROM bw_callcenter_1.users WHERE id = :u"), {"u": uid}
            )
        for tid in self.team_ids:
            s.execute(
                text("DELETE FROM bw_callcenter_1.teams WHERE id = :t"), {"t": tid}
            )
        for st_id in self.shift_type_ids:
            s.execute(
                text("DELETE FROM bw_callcenter_1.shift_types WHERE id = :s"),
                {"s": st_id},
            )
        s.commit()


@pytest.fixture
def registry(db):
    reg = Registry(db)
    yield reg
    reg.cleanup()
