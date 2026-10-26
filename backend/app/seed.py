"""Idempotent sample-data seeder.

Run with:  python -m app.seed
Safe to run multiple times — existing rows are reused, not duplicated.
"""
from datetime import date, time, timedelta

from sqlalchemy.orm import Session

from .database import SessionLocal, create_tables
from .models import ScheduleWeek, ShiftAssignment, ShiftType, Team, User
from .security import hash_password

SEED_PASSWORD = "Password123!"
WEEK_START = date(2026, 10, 26)  # Monday


def get_or_create_team(db: Session, name: str, description: str) -> Team:
    team = db.query(Team).filter(Team.name == name).first()
    if team is None:
        team = Team(name=name, description=description, active=True)
        db.add(team)
        db.flush()
    return team


def get_or_create_user(db: Session, *, name, email, role, job_title, team_id, pw_hash) -> User:
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        user = User(
            name=name,
            email=email,
            password_hash=pw_hash,
            role=role,
            job_title=job_title,
            team_id=team_id,
            active=True,
        )
        db.add(user)
        db.flush()
    else:
        # Keep team/role in sync without clobbering the password.
        user.name = name
        user.role = role
        user.job_title = job_title
        user.team_id = team_id
    return user


def get_or_create_shift_type(db: Session, name, start, end, b_start, b_end, l_start, l_end) -> ShiftType:
    st = db.query(ShiftType).filter(ShiftType.name == name).first()
    if st is None:
        st = ShiftType(
            name=name,
            start_time=start,
            end_time=end,
            break_start=b_start,
            break_end=b_end,
            lunch_start=l_start,
            lunch_end=l_end,
        )
        db.add(st)
        db.flush()
    return st


def get_or_create_week(db: Session, team_id, week_start, created_by) -> ScheduleWeek:
    wk = (
        db.query(ScheduleWeek)
        .filter(ScheduleWeek.team_id == team_id, ScheduleWeek.week_start_date == week_start)
        .first()
    )
    if wk is None:
        wk = ScheduleWeek(
            team_id=team_id,
            week_start_date=week_start,
            status="draft",
            created_by=created_by,
        )
        db.add(wk)
        db.flush()
    return wk


def get_or_create_assignment(db: Session, week_id, agent_id, work_date, shift_type_id, is_day_off) -> bool:
    existing = (
        db.query(ShiftAssignment)
        .filter(
            ShiftAssignment.schedule_week_id == week_id,
            ShiftAssignment.agent_id == agent_id,
            ShiftAssignment.work_date == work_date,
        )
        .first()
    )
    if existing is None:
        db.add(
            ShiftAssignment(
                schedule_week_id=week_id,
                agent_id=agent_id,
                work_date=work_date,
                shift_type_id=shift_type_id,
                is_day_off=is_day_off,
            )
        )
        return True
    return False


# Realistic agent names grouped by team (6 / 6 / 5 = 17).
AGENTS_BY_TEAM = {
    "Billing": [
        ("Olivia Martinez", "Senior Agent"),
        ("Liam Johnson", "Call Center Agent"),
        ("Emma Williams", "Call Center Agent"),
        ("Noah Brown", "Call Center Agent"),
        ("Ava Jones", "Call Center Agent"),
        ("William Garcia", "Call Center Agent"),
    ],
    "Support": [
        ("Sophia Miller", "Senior Agent"),
        ("James Davis", "Call Center Agent"),
        ("Isabella Rodriguez", "Call Center Agent"),
        ("Benjamin Wilson", "Call Center Agent"),
        ("Mia Anderson", "Call Center Agent"),
        ("Lucas Thomas", "Call Center Agent"),
    ],
    "Escalations": [
        ("Charlotte Taylor", "Senior Agent"),
        ("Henry Moore", "Call Center Agent"),
        ("Amelia Jackson", "Call Center Agent"),
        ("Alexander White", "Call Center Agent"),
        ("Harper Harris", "Call Center Agent"),
    ],
}

SUPERVISORS = {
    "Billing": ("Grace Bennett", "billing.supervisor@callcenter.test"),
    "Support": ("Daniel Foster", "support.supervisor@callcenter.test"),
    "Escalations": ("Natalie Reed", "escalations.supervisor@callcenter.test"),
}


def _email_for(name: str) -> str:
    return name.lower().replace(" ", ".") + "@callcenter.test"


def seed():
    create_tables()
    db = SessionLocal()
    counts = {
        "teams": 0,
        "users_admin": 0,
        "users_supervisors": 0,
        "users_agents": 0,
        "shift_types": 0,
        "schedule_weeks": 0,
        "shift_assignments": 0,
    }
    try:
        pw_hash = hash_password(SEED_PASSWORD)

        # --- Admin ---
        admin = get_or_create_user(
            db,
            name="Admin User",
            email="admin@callcenter.test",
            role="admin",
            job_title="Administrator",
            team_id=None,
            pw_hash=pw_hash,
        )
        counts["users_admin"] = 1

        # --- Teams ---
        teams = {}
        for tname, desc in [
            ("Billing", "Handles billing and payment scheduling"),
            ("Support", "General customer support staffing"),
            ("Escalations", "Complex and escalated case staffing"),
        ]:
            teams[tname] = get_or_create_team(db, tname, desc)
        counts["teams"] = len(teams)

        # --- Supervisors (one per team, set as team.supervisor_id) ---
        for tname, (sname, semail) in SUPERVISORS.items():
            sup = get_or_create_user(
                db,
                name=sname,
                email=semail,
                role="supervisor",
                job_title="Team Supervisor",
                team_id=teams[tname].id,
                pw_hash=pw_hash,
            )
            teams[tname].supervisor_id = sup.id
            counts["users_supervisors"] += 1

        # --- Agents ---
        agents_by_team = {tname: [] for tname in teams}
        for tname, members in AGENTS_BY_TEAM.items():
            for aname, title in members:
                agent = get_or_create_user(
                    db,
                    name=aname,
                    email=_email_for(aname),
                    role="agent",
                    job_title=title,
                    team_id=teams[tname].id,
                    pw_hash=pw_hash,
                )
                agents_by_team[tname].append(agent)
                counts["users_agents"] += 1

        # --- Shift types ---
        shift_defs = [
            ("Morning", time(7, 0), time(15, 0), time(9, 30), time(9, 45), time(12, 0), time(12, 30)),
            ("Mid", time(11, 0), time(19, 0), time(13, 30), time(13, 45), time(15, 30), time(16, 0)),
            ("Evening", time(15, 0), time(23, 0), time(17, 30), time(17, 45), time(19, 30), time(20, 0)),
            ("Night", time(23, 0), time(7, 0), time(1, 30), time(1, 45), time(3, 30), time(4, 0)),
        ]
        shift_types = []
        for sd in shift_defs:
            shift_types.append(get_or_create_shift_type(db, *sd))
        counts["shift_types"] = len(shift_types)

        db.flush()

        # --- Sample week per team (published) + assignments Mon-Fri ---
        for tname, team in teams.items():
            wk = get_or_create_week(db, team.id, WEEK_START, admin.id)
            wk.status = "published"
            if wk.published_at is None:
                from sqlalchemy import func as _func

                wk.published_at = _func.now()
            db.flush()
            counts["schedule_weeks"] += 1

            team_agents = agents_by_team[tname]
            # 7 days of the week: Mon(0)..Sun(6). Mon-Fri work, Sat/Sun off.
            for day_offset in range(7):
                work_date = WEEK_START + timedelta(days=day_offset)
                is_weekend = day_offset >= 5
                for idx, agent in enumerate(team_agents):
                    if is_weekend:
                        created = get_or_create_assignment(
                            db, wk.id, agent.id, work_date, None, True
                        )
                    else:
                        # Rotate agents across the 4 shift types for variety.
                        st = shift_types[(idx + day_offset) % len(shift_types)]
                        created = get_or_create_assignment(
                            db, wk.id, agent.id, work_date, st.id, False
                        )
                    if created:
                        counts["shift_assignments"] += 1

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    total_users = (
        counts["users_admin"] + counts["users_supervisors"] + counts["users_agents"]
    )
    print("=== Seed complete ===")
    print(f"teams:              {counts['teams']}")
    print(f"users (total):      {total_users}")
    print(f"  - admin:          {counts['users_admin']}")
    print(f"  - supervisors:    {counts['users_supervisors']}")
    print(f"  - agents:         {counts['users_agents']}")
    print(f"shift_types:        {counts['shift_types']}")
    print(f"schedule_weeks:     {counts['schedule_weeks']}")
    print(f"shift_assignments:  {counts['shift_assignments']} (new this run)")
    return counts


if __name__ == "__main__":
    seed()
