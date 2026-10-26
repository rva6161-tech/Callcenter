"""Teams: create / edit / delete, supervisor assignment, agent_count."""
from conftest import TEAM1_ID


def test_create_edit_delete_team(client, admin_headers, registry):
    # Create
    resp = client.post(
        "/api/teams",
        json={"name": "QA Temp Team", "description": "created by tests"},
        headers=admin_headers,
    )
    assert resp.status_code == 201, resp.text
    team = resp.json()
    tid = team["id"]
    registry.team(tid)
    assert team["name"] == "QA Temp Team"
    assert team["agents"] == []

    # Edit
    resp = client.put(
        f"/api/teams/{tid}",
        json={"description": "edited", "name": "QA Temp Team 2"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "QA Temp Team 2"
    assert resp.json()["description"] == "edited"

    # Delete
    resp = client.delete(f"/api/teams/{tid}", headers=admin_headers)
    assert resp.status_code == 204
    # Gone
    assert client.get(f"/api/teams/{tid}", headers=admin_headers).status_code == 404


def test_assign_supervisor_and_agent_count(client, admin_headers, registry):
    # Create a temp team + temp agents, assign a supervisor, check agent_count.
    resp = client.post("/api/teams", json={"name": "QA Count Team"}, headers=admin_headers)
    assert resp.status_code == 201
    tid = resp.json()["id"]
    registry.team(tid)

    # Two agents on the team.
    for i in range(2):
        r = client.post(
            "/api/users",
            json={
                "name": f"QA CountAgent {i}",
                "email": f"qa.count.agent{i}@callcenter.test",
                "role": "agent",
                "team_id": tid,
            },
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        registry.user(r.json()["id"])

    # A user to promote to supervisor.
    r = client.post(
        "/api/users",
        json={
            "name": "QA Count Sup",
            "email": "qa.count.sup@callcenter.test",
            "role": "agent",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201
    sup_id = r.json()["id"]
    registry.user(sup_id)

    # Assign as supervisor via team update.
    r = client.put(
        f"/api/teams/{tid}", json={"supervisor_id": sup_id}, headers=admin_headers
    )
    assert r.status_code == 200
    assert r.json()["supervisor"]["id"] == sup_id

    # agent_count in the list view reflects exactly the 2 agents (not the sup).
    teams = client.get("/api/teams", headers=admin_headers).json()
    row = next(t for t in teams if t["id"] == tid)
    assert row["agent_count"] == 2


def test_create_duplicate_team_name_400(client, admin_headers):
    resp = client.post("/api/teams", json={"name": "Billing"}, headers=admin_headers)
    assert resp.status_code == 400


def test_get_seeded_team_detail(client, admin_headers):
    resp = client.get(f"/api/teams/{TEAM1_ID}", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Billing"
    # Billing seeded with 6 agents.
    assert len(body["agents"]) == 6
