"""RBAC matrix across roles and protected endpoints."""
from conftest import TEAM1_ID, TEAM2_ID, WK_PUBLISH


# --------------------------------------------------------------------------- #
# Agent is blocked (403) from every management + schedule endpoint.
# --------------------------------------------------------------------------- #
def test_agent_blocked_from_teams(client, agent_headers):
    assert client.get("/api/teams", headers=agent_headers).status_code == 403


def test_agent_blocked_from_users(client, agent_headers):
    assert client.get("/api/users", headers=agent_headers).status_code == 403


def test_agent_blocked_from_shift_types(client, agent_headers):
    assert client.get("/api/shift-types", headers=agent_headers).status_code == 403


def test_agent_blocked_from_schedule(client, agent_headers):
    resp = client.get(
        "/api/schedule",
        params={"team_id": TEAM1_ID, "week_start": WK_PUBLISH.isoformat()},
        headers=agent_headers,
    )
    assert resp.status_code == 403


def test_agent_blocked_from_publish(client, agent_headers):
    resp = client.post(
        "/api/schedule/publish",
        json={"team_id": TEAM1_ID, "week_start": WK_PUBLISH.isoformat()},
        headers=agent_headers,
    )
    assert resp.status_code == 403


# --------------------------------------------------------------------------- #
# Supervisor: can GET own team, forbidden on another, cannot write teams.
# --------------------------------------------------------------------------- #
def test_supervisor_can_get_own_team(client, sup1_headers):
    resp = client.get(f"/api/teams/{TEAM1_ID}", headers=sup1_headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == TEAM1_ID


def test_supervisor_cannot_get_other_team(client, sup1_headers):
    resp = client.get(f"/api/teams/{TEAM2_ID}", headers=sup1_headers)
    assert resp.status_code == 403


def test_supervisor_cannot_create_team(client, sup1_headers):
    resp = client.post(
        "/api/teams", json={"name": "SupervisorShouldNotCreate"}, headers=sup1_headers
    )
    assert resp.status_code == 403


def test_supervisor_cannot_update_team(client, sup1_headers):
    resp = client.put(
        f"/api/teams/{TEAM1_ID}", json={"description": "x"}, headers=sup1_headers
    )
    assert resp.status_code == 403


def test_supervisor_cannot_access_other_team_schedule(client, sup1_headers):
    resp = client.get(
        "/api/schedule",
        params={"team_id": TEAM2_ID, "week_start": WK_PUBLISH.isoformat()},
        headers=sup1_headers,
    )
    assert resp.status_code == 403


# --------------------------------------------------------------------------- #
# Admin: full access.
# --------------------------------------------------------------------------- #
def test_admin_can_list_teams(client, admin_headers):
    resp = client.get("/api/teams", headers=admin_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 3


def test_admin_can_list_users(client, admin_headers):
    resp = client.get("/api/users", headers=admin_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 21
