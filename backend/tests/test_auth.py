"""Auth: login success, wrong password, /api/auth/me with and without token."""
from conftest import ADMIN_EMAIL, SEED_PASSWORD, login


def test_login_success_returns_jwt_and_user(client):
    resp = login(client, ADMIN_EMAIL)
    assert resp.status_code == 200
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert isinstance(body["access_token"], str) and body["access_token"]
    assert body["user"]["email"] == ADMIN_EMAIL
    assert body["user"]["role"] == "admin"
    # Password hash must never leak in the response.
    assert "password_hash" not in body["user"]


def test_login_wrong_password_401(client):
    resp = login(client, ADMIN_EMAIL, "definitely-wrong")
    assert resp.status_code == 401


def test_login_unknown_email_401(client):
    resp = login(client, "nobody@callcenter.test", SEED_PASSWORD)
    assert resp.status_code == 401


def test_me_with_token_200(client, admin_headers):
    resp = client.get("/api/auth/me", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == ADMIN_EMAIL
    assert body["role"] == "admin"


def test_me_without_token_401(client):
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401


def test_me_with_bad_token_401(client):
    resp = client.get(
        "/api/auth/me", headers={"Authorization": "Bearer not.a.real.jwt"}
    )
    assert resp.status_code == 401
