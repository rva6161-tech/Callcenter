"""Team management routes (Phase 2).

Role scoping:
  - admin:      full access to all teams.
  - supervisor: read-only, only their own team.
  - agent:      no access (403).
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ScheduleWeek, Team, User
from ..schemas import (
    SupervisorSummary,
    TeamAgent,
    TeamCreate,
    TeamDetail,
    TeamListItem,
    TeamUpdate,
)
from ..security import get_current_user, require_role

router = APIRouter(prefix="/api/teams", tags=["teams"])


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _agent_count(db: Session, team_id: int) -> int:
    return (
        db.query(User)
        .filter(User.team_id == team_id, User.role == "agent")
        .count()
    )


def _supervisor_summary(team: Team) -> Optional[SupervisorSummary]:
    if team.supervisor is None:
        return None
    return SupervisorSummary.model_validate(team.supervisor)


def _list_item(db: Session, team: Team) -> TeamListItem:
    return TeamListItem(
        id=team.id,
        name=team.name,
        description=team.description,
        active=team.active,
        agent_count=_agent_count(db, team.id),
        supervisor=_supervisor_summary(team),
    )


def _detail(db: Session, team: Team) -> TeamDetail:
    agents = (
        db.query(User)
        .filter(User.team_id == team.id, User.role == "agent")
        .order_by(User.name)
        .all()
    )
    return TeamDetail(
        id=team.id,
        name=team.name,
        description=team.description,
        active=team.active,
        supervisor=_supervisor_summary(team),
        agents=[TeamAgent.model_validate(a) for a in agents],
    )


def _forbidden() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
    )


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #


@router.get("", response_model=List[TeamListItem])
def list_teams(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role == "admin":
        teams = db.query(Team).order_by(Team.id).all()
    elif current_user.role == "supervisor":
        if current_user.team_id is None:
            teams = []
        else:
            teams = db.query(Team).filter(Team.id == current_user.team_id).all()
    else:  # agent
        raise _forbidden()
    return [_list_item(db, t) for t in teams]


@router.get("/{team_id}", response_model=TeamDetail)
def get_team(
    team_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role == "agent":
        raise _forbidden()
    if current_user.role == "supervisor" and current_user.team_id != team_id:
        raise _forbidden()
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Team not found"
        )
    return _detail(db, team)


@router.post(
    "",
    response_model=TeamDetail,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role("admin"))],
)
def create_team(payload: TeamCreate, db: Session = Depends(get_db)):
    if db.query(Team).filter(Team.name == payload.name).first() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Team name already exists"
        )
    team = Team(name=payload.name, description=payload.description, active=True)
    db.add(team)
    db.commit()
    db.refresh(team)
    return _detail(db, team)


@router.put(
    "/{team_id}",
    response_model=TeamDetail,
    dependencies=[Depends(require_role("admin"))],
)
def update_team(team_id: int, payload: TeamUpdate, db: Session = Depends(get_db)):
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Team not found"
        )

    data = payload.model_dump(exclude_unset=True)

    if "name" in data and data["name"] != team.name:
        dup = (
            db.query(Team)
            .filter(Team.name == data["name"], Team.id != team_id)
            .first()
        )
        if dup is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Team name already exists",
            )
        team.name = data["name"]

    if "description" in data:
        team.description = data["description"]

    if "active" in data:
        team.active = data["active"]

    if "supervisor_id" in data:
        sup_id = data["supervisor_id"]
        if sup_id is not None:
            sup = db.get(User, sup_id)
            if sup is None or not sup.active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="supervisor_id must reference an existing active user",
                )
            # Promote the user and attach them to this team; leave any previous
            # supervisor untouched (just reassign the pointer).
            sup.role = "supervisor"
            sup.team_id = team.id
            team.supervisor_id = sup.id
        else:
            team.supervisor_id = None

    db.commit()
    db.refresh(team)
    return _detail(db, team)


@router.delete(
    "/{team_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_role("admin"))],
)
def delete_team(team_id: int, db: Session = Depends(get_db)):
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Team not found"
        )

    # Detach all members and clear the supervisor pointer first.
    db.query(User).filter(User.team_id == team_id).update(
        {User.team_id: None}, synchronize_session=False
    )
    team.supervisor_id = None
    db.flush()

    # Remove this team's schedule weeks explicitly (shift_assignments cascade
    # via FK ON DELETE CASCADE at the DB level).
    db.query(ScheduleWeek).filter(ScheduleWeek.team_id == team_id).delete(
        synchronize_session=False
    )

    db.delete(team)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
