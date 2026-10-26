"""Shift types: list the 4 seeded, create + edit (cleaned up after)."""


def test_list_returns_four_seeded(client, admin_headers):
    resp = client.get("/api/shift-types", headers=admin_headers)
    assert resp.status_code == 200
    types = resp.json()
    assert len(types) == 4
    names = {t["name"] for t in types}
    assert {"Morning", "Mid", "Evening", "Night"} <= names
    night = next(t for t in types if t["name"] == "Night")
    assert night["start_time"] == "23:00"
    assert night["end_time"] == "07:00"


def test_create_and_edit_shift_type(client, admin_headers, registry):
    # Create
    resp = client.post(
        "/api/shift-types",
        json={
            "name": "QA Split",
            "start_time": "08:00",
            "end_time": "16:30",
            "lunch_start": "12:00",
            "lunch_end": "12:30",
        },
        headers=admin_headers,
    )
    assert resp.status_code == 201, resp.text
    st = resp.json()
    registry.shift_type(st["id"])
    assert st["start_time"] == "08:00"
    assert st["end_time"] == "16:30"
    assert st["lunch_start"] == "12:00"

    # Edit
    resp = client.put(
        f"/api/shift-types/{st['id']}",
        json={"name": "QA Split Edited", "end_time": "17:00"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "QA Split Edited"
    assert resp.json()["end_time"] == "17:00"


def test_supervisor_can_read_shift_types(client, sup1_headers):
    # Shift types are readable by admin + supervisor.
    resp = client.get("/api/shift-types", headers=sup1_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 4


def test_create_shift_type_bad_time_422(client, admin_headers):
    resp = client.post(
        "/api/shift-types",
        json={"name": "QA Bad", "start_time": "25:00", "end_time": "16:00"},
        headers=admin_headers,
    )
    assert resp.status_code == 422
