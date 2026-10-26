"""Users: create agent, move team, deactivate. Cleaned up afterward."""
from conftest import TEAM1_ID, TEAM2_ID


def test_create_move_and_deactivate_agent(client, admin_headers, registry):
    # Create agent on team 1.
    resp = client.post(
        "/api/users",
        json={
            "name": "QA Mobile Agent",
            "email": "qa.mobile.agent@callcenter.test",
            "role": "agent",
            "team_id": TEAM1_ID,
            "job_title": "Call Center Agent",
        },
        headers=admin_headers,
    )
    assert resp.status_code == 201, resp.text
    user = resp.json()
    uid = user["id"]
    registry.user(uid)
    assert user["team_id"] == TEAM1_ID
    assert user["active"] is True
    assert "password_hash" not in user

    # Move to team 2.
    resp = client.put(
        f"/api/users/{uid}", json={"team_id": TEAM2_ID}, headers=admin_headers
    )
    assert resp.status_code == 200
    assert resp.json()["team_id"] == TEAM2_ID

    # Deactivate.
    resp = client.put(f"/api/users/{uid}", json={"active": False}, headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["active"] is False

    # A deactivated user can no longer log in.
    login = client.post(
        "/api/auth/login",
        json={"email": "qa.mobile.agent@callcenter.test", "password": "Password123!"},
    )
    assert login.status_code == 401


def test_create_duplicate_email_400(client, admin_headers):
    resp = client.post(
        "/api/users",
        json={"name": "Dup", "email": "admin@callcenter.test", "role": "agent"},
        headers=admin_headers,
    )
    assert resp.status_code == 400


def test_create_user_invalid_role_422(client, admin_headers):
    resp = client.post(
        "/api/users",
        json={"name": "Bad", "email": "qa.badrole@callcenter.test", "role": "wizard"},
        headers=admin_headers,
    )
    assert resp.status_code == 422


def test_list_users_filter_by_team(client, admin_headers):
    resp = client.get("/api/users", params={"team_id": TEAM1_ID}, headers=admin_headers)
    assert resp.status_code == 200
    users = resp.json()
    # Billing: 6 agents + 1 supervisor = 7 members.
    assert len(users) == 7
    assert all(u["team_id"] == TEAM1_ID for u in users)
