"""Weekly schedule engine (Phase 3).

Role scoping:
  - admin:      any team.
  - supervisor: their own team only (team_id must match), else 403.
  - agent:      no access (403) — the agent-facing published view is Phase 4.

Dates are ISO 'YYYY-MM-DD'. ``week_start`` is always a Monday and a week spans
week_start .. week_start+6 (Mon..Sun). Shift time maths use real datetimes so
overnight shifts (e.g. Night 23:00->07:00) are handled correctly.

NOTE: the publish action and the agent-facing view are intentionally *not*
implemented here — they are Phase 4. The ``status`` field is kept and surfaced.
"""
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ScheduleWeek, ShiftAssignment, ShiftType, Team, User
from ..schemas import (
    AssignmentOut,
    AssignmentSaved,
    AssignmentUpsert,
    CopyLastWeekRequest,
    MyScheduleOut,
    MyScheduleShift,
    PublishRequest,
    PublishResponse,
    ScheduleAgent,
    ScheduleGrid,
    ScheduleTeam,
)
from ..security import get_current_user
from .shift_types import shift_type_to_out

router = APIRouter(prefix="/api/schedule", tags=["schedule"])

REST_THRESHOLD = timedelta(hours=11)


# --------------------------------------------------------------------------- #
# Access / validation helpers
# --------------------------------------------------------------------------- #


def _forbidden() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
    )


def _require_team_access(current_user: User, team_id: int) -> None:
    """admin -> any team; supervisor -> own team only; agent -> 403."""
    if current_user.role == "admin":
        return
    if current_user.role == "supervisor":
        if current_user.team_id != team_id:
            raise _forbidden()
        return
    raise _forbidden()


def _require_monday(week_start: date) -> None:
    if week_start.weekday() != 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="week_start must be a Monday",
        )


def _get_team(db: Session, team_id: int) -> Team:
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Team not found"
        )
    return team


def _week_dates(week_start: date) -> List[date]:
    return [week_start + timedelta(days=i) for i in range(7)]


# --------------------------------------------------------------------------- #
# Time-interval helpers (overnight-aware)
# --------------------------------------------------------------------------- #


def _interval(work_date: date, start_t: time, end_t: time) -> Tuple[datetime, datetime]:
    """Real datetime interval for a shift; end rolls to next day if overnight."""
    start_dt = datetime.combine(work_date, start_t)
    if end_t <= start_t:  # overnight (e.g. 23:00 -> 07:00)
        end_dt = datetime.combine(work_date + timedelta(days=1), end_t)
    else:
        end_dt = datetime.combine(work_date, end_t)
    return start_dt, end_dt


def _overlaps(a: Tuple[datetime, datetime], b: Tuple[datetime, datetime]) -> bool:
    return a[0] < b[1] and b[0] < a[1]


def _gap(a: Tuple[datetime, datetime], b: Tuple[datetime, datetime]) -> Optional[timedelta]:
    """Rest gap between two non-overlapping intervals (None if they overlap)."""
    if a[1] <= b[0]:
        return b[0] - a[1]
    if b[1] <= a[0]:
        return a[0] - b[1]
    return None


def _fmt_hours(td: timedelta) -> str:
    hours = td.total_seconds() / 3600
    return f"{hours:g}h"


def _neighbour_assignments(
    db: Session,
    team_id: int,
    agent_id: int,
    work_date: date,
    exclude_assignment_id: Optional[int],
) -> List[Tuple[date, ShiftType]]:
    """The agent's other working shifts on the day and its immediate neighbours.

    Covers work_date-1 .. work_date+1 across any schedule_week of the team, so
    overnight shifts spanning the week boundary are still compared. Day-off
    cells and cells with no shift type are ignored (they have no interval).
    """
    lo = work_date - timedelta(days=1)
    hi = work_date + timedelta(days=1)
    rows = (
        db.query(ShiftAssignment, ShiftType)
        .join(ScheduleWeek, ShiftAssignment.schedule_week_id == ScheduleWeek.id)
        .join(ShiftType, ShiftAssignment.shift_type_id == ShiftType.id)
        .filter(
            ScheduleWeek.team_id == team_id,
            ShiftAssignment.agent_id == agent_id,
            ShiftAssignment.is_day_off.is_(False),
            ShiftAssignment.work_date >= lo,
            ShiftAssignment.work_date <= hi,
        )
        .all()
    )
    out: List[Tuple[date, ShiftType]] = []
    for assignment, st in rows:
        if exclude_assignment_id is not None and assignment.id == exclude_assignment_id:
            continue
        out.append((assignment.work_date, st))
    return out


def _check_overlap_and_rest(
    new_date: date,
    new_st: ShiftType,
    neighbours: List[Tuple[date, ShiftType]],
) -> Tuple[Optional[Tuple[date, date]], List[str]]:
    """Return (conflict_pair_or_None, warnings).

    conflict_pair is set (and should block with 409) when the new shift's real
    interval overlaps a neighbour. Otherwise a 'Low rest' warning is produced if
    the nearest neighbour is closer than the 11h threshold.
    """
    new_iv = _interval(new_date, new_st.start_time, new_st.end_time)
    best_gap: Optional[timedelta] = None
    best_pair: Optional[Tuple[date, date]] = None
    for n_date, n_st in neighbours:
        n_iv = _interval(n_date, n_st.start_time, n_st.end_time)
        if _overlaps(new_iv, n_iv):
            return (n_date, new_date), []
        gap = _gap(new_iv, n_iv)
        if gap is not None and (best_gap is None or gap < best_gap):
            best_gap = gap
            # order the pair chronologically for a readable message
            if new_iv[0] <= n_iv[0]:
                best_pair = (new_date, n_date)
            else:
                best_pair = (n_date, new_date)

    warnings: List[str] = []
    if best_gap is not None and best_gap < REST_THRESHOLD and best_pair is not None:
        a, b = best_pair
        warnings.append(
            f"Low rest: only {_fmt_hours(best_gap)} between "
            f"{a.strftime('%A')} ({a.isoformat()}) and "
            f"{b.strftime('%A')} ({b.isoformat()})"
        )
    return None, warnings


# --------------------------------------------------------------------------- #
# GET /api/schedule — read-only grid
# --------------------------------------------------------------------------- #


@router.get("", response_model=ScheduleGrid)
def get_schedule(
    team_id: int = Query(...),
    week_start: date = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_team_access(current_user, team_id)
    _require_monday(week_start)
    team = _get_team(db, team_id)
    dates = _week_dates(week_start)

    shift_types = db.query(ShiftType).order_by(ShiftType.id).all()
    agents = (
        db.query(User)
        .filter(User.team_id == team_id, User.role == "agent", User.active.is_(True))
        .order_by(User.name)
        .all()
    )

    week = (
        db.query(ScheduleWeek)
        .filter(
            ScheduleWeek.team_id == team_id,
            ScheduleWeek.week_start_date == week_start,
        )
        .first()
    )

    assignments: List[ShiftAssignment] = []
    status_val = "none"
    published_at = None
    if week is not None:
        status_val = week.status
        published_at = week.published_at
        assignments = (
            db.query(ShiftAssignment)
            .filter(ShiftAssignment.schedule_week_id == week.id)
            .all()
        )

    # day_counts: agents with a real shift (not day-off), one entry per day.
    day_counts: Dict[str, int] = {d.isoformat(): 0 for d in dates}
    for a in assignments:
        if not a.is_day_off and a.shift_type_id is not None:
            key = a.work_date.isoformat()
            if key in day_counts:
                day_counts[key] += 1

    return ScheduleGrid(
        team=ScheduleTeam(id=team.id, name=team.name),
        week_start=week_start,
        week_dates=dates,
        status=status_val,
        published_at=published_at,
        shift_types=[shift_type_to_out(st) for st in shift_types],
        agents=[ScheduleAgent.model_validate(a) for a in agents],
        assignments=[AssignmentOut.model_validate(a) for a in assignments],
        day_counts=day_counts,
    )


# --------------------------------------------------------------------------- #
# Shared helpers for mutating endpoints
# --------------------------------------------------------------------------- #


def _get_or_create_week(
    db: Session, team_id: int, week_start: date, created_by: int
) -> ScheduleWeek:
    week = (
        db.query(ScheduleWeek)
        .filter(
            ScheduleWeek.team_id == team_id,
            ScheduleWeek.week_start_date == week_start,
        )
        .first()
    )
    if week is None:
        week = ScheduleWeek(
            team_id=team_id,
            week_start_date=week_start,
            status="draft",
            created_by=created_by,
        )
        db.add(week)
        db.flush()
    return week


def _validate_agent_on_team(db: Session, agent_id: int, team_id: int) -> None:
    agent = db.get(User, agent_id)
    if agent is None or agent.team_id != team_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="agent does not belong to this team",
        )


def _upsert_cell(
    db: Session,
    week: ScheduleWeek,
    agent_id: int,
    work_date: date,
    shift_type_id: Optional[int],
    is_day_off: bool,
) -> Tuple[ShiftAssignment, bool]:
    """Insert or update a cell on the unique (week, agent, date). Returns
    (assignment, created)."""
    existing = (
        db.query(ShiftAssignment)
        .filter(
            ShiftAssignment.schedule_week_id == week.id,
            ShiftAssignment.agent_id == agent_id,
            ShiftAssignment.work_date == work_date,
        )
        .first()
    )
    if existing is None:
        assignment = ShiftAssignment(
            schedule_week_id=week.id,
            agent_id=agent_id,
            work_date=work_date,
            shift_type_id=shift_type_id,
            is_day_off=is_day_off,
        )
        db.add(assignment)
        db.flush()
        return assignment, True
    existing.shift_type_id = shift_type_id
    existing.is_day_off = is_day_off
    db.flush()
    return existing, False


# --------------------------------------------------------------------------- #
# PUT /api/schedule/assignment — upsert one cell
# --------------------------------------------------------------------------- #


@router.put("/assignment", response_model=AssignmentSaved)
def upsert_assignment(
    payload: AssignmentUpsert,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_team_access(current_user, payload.team_id)
    _require_monday(payload.week_start)
    _get_team(db, payload.team_id)

    dates = _week_dates(payload.week_start)
    if payload.work_date not in dates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="work_date must fall within the week (Mon..Sun)",
        )

    _validate_agent_on_team(db, payload.agent_id, payload.team_id)

    shift_type: Optional[ShiftType] = None
    if payload.is_day_off:
        shift_type_id = None
    else:
        if payload.shift_type_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="shift_type_id is required unless is_day_off is true",
            )
        shift_type = db.get(ShiftType, payload.shift_type_id)
        if shift_type is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="shift_type_id does not reference an existing shift type",
            )
        shift_type_id = shift_type.id

    week = _get_or_create_week(
        db, payload.team_id, payload.week_start, current_user.id
    )

    # Overlap / rest checks only apply to real shifts, and must ignore the cell
    # being replaced (same week/agent/date).
    warnings: List[str] = []
    if shift_type is not None:
        existing = (
            db.query(ShiftAssignment)
            .filter(
                ShiftAssignment.schedule_week_id == week.id,
                ShiftAssignment.agent_id == payload.agent_id,
                ShiftAssignment.work_date == payload.work_date,
            )
            .first()
        )
        neighbours = _neighbour_assignments(
            db,
            payload.team_id,
            payload.agent_id,
            payload.work_date,
            exclude_assignment_id=existing.id if existing else None,
        )
        conflict, warnings = _check_overlap_and_rest(
            payload.work_date, shift_type, neighbours
        )
        if conflict is not None:
            a, b = conflict
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Shift overlaps the agent's existing shift "
                    f"({a.isoformat()} / {b.isoformat()}). Not saved."
                ),
            )

    assignment, created = _upsert_cell(
        db,
        week,
        payload.agent_id,
        payload.work_date,
        shift_type_id,
        payload.is_day_off,
    )
    db.commit()
    db.refresh(assignment)

    response.status_code = (
        status.HTTP_201_CREATED if created else status.HTTP_200_OK
    )
    return AssignmentSaved(
        id=assignment.id,
        agent_id=assignment.agent_id,
        work_date=assignment.work_date,
        shift_type_id=assignment.shift_type_id,
        is_day_off=assignment.is_day_off,
        warnings=warnings,
    )


# --------------------------------------------------------------------------- #
# DELETE /api/schedule/assignment/{id}
# --------------------------------------------------------------------------- #


@router.delete("/assignment/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assignment(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    assignment = db.get(ShiftAssignment, assignment_id)
    if assignment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found"
        )
    week = db.get(ScheduleWeek, assignment.schedule_week_id)
    _require_team_access(current_user, week.team_id)

    db.delete(assignment)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------- #
# POST /api/schedule/copy-last-week
# --------------------------------------------------------------------------- #


@router.post("/copy-last-week")
def copy_last_week(
    payload: CopyLastWeekRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_team_access(current_user, payload.team_id)
    _require_monday(payload.week_start)
    _get_team(db, payload.team_id)

    prev_start = payload.week_start - timedelta(days=7)
    prev_week = (
        db.query(ScheduleWeek)
        .filter(
            ScheduleWeek.team_id == payload.team_id,
            ScheduleWeek.week_start_date == prev_start,
        )
        .first()
    )
    prev_assignments: List[ShiftAssignment] = []
    if prev_week is not None:
        prev_assignments = (
            db.query(ShiftAssignment)
            .filter(ShiftAssignment.schedule_week_id == prev_week.id)
            .order_by(ShiftAssignment.work_date, ShiftAssignment.agent_id)
            .all()
        )
    if not prev_assignments:
        return {"created": 0, "skipped": 0, "message": "No previous week to copy"}

    target = _get_or_create_week(
        db, payload.team_id, payload.week_start, current_user.id
    )

    # Track what the target week will contain as we go, per agent, so copied
    # shifts are checked for overlap against each other (and prior target cells).
    placed: Dict[int, List[Tuple[date, ShiftType]]] = {}
    for assignment, st in (
        db.query(ShiftAssignment, ShiftType)
        .join(ShiftType, ShiftAssignment.shift_type_id == ShiftType.id)
        .filter(ShiftAssignment.schedule_week_id == target.id)
        .all()
    ):
        placed.setdefault(assignment.agent_id, []).append((assignment.work_date, st))

    created = 0
    skipped = 0
    for src in prev_assignments:
        new_date = src.work_date + timedelta(days=7)
        if src.is_day_off or src.shift_type_id is None:
            # day-off / empty cells never overlap — copy straight across.
            _upsert_cell(db, target, src.agent_id, new_date, None, src.is_day_off)
            created += 1
            continue

        st = db.get(ShiftType, src.shift_type_id)
        existing = placed.get(src.agent_id, [])
        # ignore any cell we'd replace on the same date
        neighbours = [(d, s) for (d, s) in existing if d != new_date]
        conflict, _ = _check_overlap_and_rest(new_date, st, neighbours)
        if conflict is not None:
            skipped += 1
            continue

        _upsert_cell(db, target, src.agent_id, new_date, st.id, False)
        # refresh placed list for this agent (replace same-date entry)
        placed[src.agent_id] = neighbours + [(new_date, st)]
        created += 1

    db.commit()
    return {"created": created, "skipped": skipped, "status": "draft"}


# --------------------------------------------------------------------------- #
# Phase 4 — Publishing (admin any team / supervisor own team)
# --------------------------------------------------------------------------- #


def _get_existing_week(db: Session, team_id: int, week_start: date) -> ScheduleWeek:
    """Fetch the schedule_week for (team, week) or 404 if it was never created."""
    week = (
        db.query(ScheduleWeek)
        .filter(
            ScheduleWeek.team_id == team_id,
            ScheduleWeek.week_start_date == week_start,
        )
        .first()
    )
    if week is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No schedule to publish for this week",
        )
    return week


@router.post("/publish", response_model=PublishResponse)
def publish_schedule(
    payload: PublishRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_team_access(current_user, payload.team_id)
    _require_monday(payload.week_start)
    _get_team(db, payload.team_id)

    week = _get_existing_week(db, payload.team_id, payload.week_start)
    week.status = "published"
    week.published_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(week)

    return PublishResponse(
        team_id=week.team_id,
        week_start=week.week_start_date,
        status=week.status,
        published_at=week.published_at,
    )


@router.post("/unpublish", response_model=PublishResponse)
def unpublish_schedule(
    payload: PublishRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_team_access(current_user, payload.team_id)
    _require_monday(payload.week_start)
    _get_team(db, payload.team_id)

    week = _get_existing_week(db, payload.team_id, payload.week_start)
    week.status = "draft"
    week.published_at = None
    db.commit()
    db.refresh(week)

    return PublishResponse(
        team_id=week.team_id,
        week_start=week.week_start_date,
        status=week.status,
        published_at=week.published_at,
    )


# --------------------------------------------------------------------------- #
# Phase 4 — GET /api/my-schedule — the logged-in agent's own published shifts
# --------------------------------------------------------------------------- #


def _current_monday() -> date:
    """Monday of the current week, computed server-side in UTC."""
    today = datetime.now(timezone.utc).date()
    return today - timedelta(days=today.weekday())


# The agent-facing view lives at /api/my-schedule (outside the /api/schedule
# prefix), so it gets its own router, registered alongside this one in main.py.
my_schedule_router = APIRouter(tags=["schedule"])


@my_schedule_router.get("/api/my-schedule", response_model=MyScheduleOut)
def my_schedule(
    week_start: Optional[date] = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if week_start is None:
        week_start = _current_monday()
    dates = _week_dates(week_start)

    # No team -> nothing to show.
    if current_user.team_id is None:
        return MyScheduleOut(
            week_start=week_start,
            week_dates=dates,
            published=False,
            status="none",
            shifts=[],
        )

    week = (
        db.query(ScheduleWeek)
        .filter(
            ScheduleWeek.team_id == current_user.team_id,
            ScheduleWeek.week_start_date == week_start,
        )
        .first()
    )

    # Missing or unpublished -> agents must not see draft data.
    if week is None or week.status != "published":
        return MyScheduleOut(
            week_start=week_start,
            week_dates=dates,
            published=False,
            status=(week.status if week is not None else "none"),
            shifts=[],
        )

    assignments = (
        db.query(ShiftAssignment)
        .filter(
            ShiftAssignment.schedule_week_id == week.id,
            ShiftAssignment.agent_id == current_user.id,
        )
        .order_by(ShiftAssignment.work_date)
        .all()
    )

    shifts = [
        MyScheduleShift(
            work_date=a.work_date,
            is_day_off=a.is_day_off,
            shift_type=shift_type_to_out(a.shift_type)
            if a.shift_type is not None
            else None,
        )
        for a in assignments
    ]

    return MyScheduleOut(
        week_start=week_start,
        week_dates=dates,
        published=True,
        status="published",
        published_at=week.published_at,
        shifts=shifts,
    )
