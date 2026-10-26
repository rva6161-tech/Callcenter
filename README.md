# Callcenter — Scheduling App (Backend, Phase 1)

A staff **scheduling** application for a call center (shift timings + team
management). It does **not** make or track phone calls.

**Stack:** Python · FastAPI · SQLAlchemy · PostgreSQL

> Phase 1 scope: app scaffold, full database schema, auth/logins/roles, and a
> sample-data seed. Team-management CRUD, schedule editing, and publishing
> endpoints come in later phases. The **full** schema is created now so sample
> data can be seeded.

## Project layout

```
backend/
  app/
    main.py          FastAPI app (CORS, health routes)
    config.py        env-driven config (DATABASE_URL, JWT_SECRET)
    database.py      SQLAlchemy engine + SessionLocal + Base
    models.py        ORM models (all tables, schema bw_callcenter_1)
    schemas.py       Pydantic request/response models
    security.py      bcrypt hashing, JWT, auth dependencies
    routers/auth.py  POST /api/auth/login, GET /api/auth/me
    seed.py          idempotent sample-data seeder
requirements.txt
README.md
```

## Requirements

- Python 3.10+
- PostgreSQL with schema `bw_callcenter_1`
- Environment variables (already configured in this environment):
  - `DATABASE_URL` — e.g. `postgresql+psycopg2://user:pass@host:5432/db?options=-c%20search_path%3Dbw_callcenter_1`
  - `JWT_SECRET` — secret used to sign JWTs (HS256)

## Install

```bash
cd /home/ubuntu/app/backend
python3 -m venv venv
venv/bin/pip install -r ../requirements.txt
```

## Seed sample data

Creates the schema/tables if missing and inserts sample data. Idempotent — safe
to run more than once.

```bash
cd /home/ubuntu/app/backend
venv/bin/python -m app.seed
```

## Run the API

```bash
cd /home/ubuntu/app/backend
venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- Health: `GET http://localhost:8000/` and `GET http://localhost:8000/api/health` → `{"status":"ok"}`
- Interactive docs: `http://localhost:8000/docs`

### Example login

```bash
curl -s -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@callcenter.test","password":"Password123!"}'
```

Use the returned `access_token` as a Bearer token:

```bash
curl -s http://localhost:8000/api/auth/me -H "Authorization: Bearer <token>"
```

## Sample logins

All seeded users share the password **`Password123!`**.

| Role       | Email                                   | Password       |
|------------|-----------------------------------------|----------------|
| admin      | `admin@callcenter.test`                 | `Password123!` |
| supervisor | `billing.supervisor@callcenter.test`    | `Password123!` |
| agent      | `olivia.martinez@callcenter.test`       | `Password123!` |

Other supervisors: `support.supervisor@callcenter.test`,
`escalations.supervisor@callcenter.test`. All 17 agent emails follow the
`first.last@callcenter.test` pattern.

## Database schema (`bw_callcenter_1`)

- **teams** — name, description, supervisor_id → users, active
- **users** — name, email, password_hash, role (`admin`/`supervisor`/`agent`), job_title, team_id → teams, active
- **shift_types** — name, start/end time, break + lunch windows
- **schedule_weeks** — team_id, week_start_date (Monday), status (`draft`/`published`), published_at, unique(team_id, week_start_date)
- **shift_assignments** — schedule_week_id, agent_id, work_date, shift_type_id, is_day_off, unique(schedule_week_id, agent_id, work_date)
