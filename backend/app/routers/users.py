"""User management routes (Phase 2) — agents + supervisors.

Role scoping:
  - admin:      full access; create/update any user.
  - supervisor: read-only, only their own team's members.
  - agent:      no access (403).

Users are never hard-deleted; deactivation is a PUT with active=false.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Team, User
from ..schemas import UserCreate, UserItem, UserUpdate
from ..security import get_current_user, hash_password, require_role

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=List[UserItem])
def list_users(
    team_id: Optional[int] = Query(None),
    role: Optional[str] = Query(None),
    active: Optional[bool] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role == "agent":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
        )

    q = db.query(User)

    if current_user.role == "supervisor":
        # Supervisors only ever see their own team's members.
        if current_user.team_id is None:
            return []
        q = q.filter(User.team_id == current_user.team_id)

    if team_id is not None:
        q = q.filter(User.team_id == team_id)
    if role is not None:
        q = q.filter(User.role == role)
    if active is not None:
        q = q.filter(User.active == active)

    users = q.order_by(User.id).all()
    return [UserItem.model_validate(u) for u in users]


@router.post(
    "",
    response_model=UserItem,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role("admin"))],
)
def create_user(payload: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == payload.email).first() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Email already exists"
        )
    if payload.team_id is not None and db.get(Team, payload.team_id) is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="team_id must reference an existing team",
        )

    user = User(
        name=payload.name,
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=payload.role,
        job_title=payload.job_title,
        team_id=payload.team_id,
        active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserItem.model_validate(user)


@router.put(
    "/{user_id}",
    response_model=UserItem,
    dependencies=[Depends(require_role("admin"))],
)
def update_user(user_id: int, payload: UserUpdate, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    data = payload.model_dump(exclude_unset=True)

    if "email" in data and data["email"] != user.email:
        dup = (
            db.query(User)
            .filter(User.email == data["email"], User.id != user_id)
            .first()
        )
        if dup is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already exists",
            )

    if "team_id" in data and data["team_id"] is not None:
        if db.get(Team, data["team_id"]) is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="team_id must reference an existing team",
            )

    for field in ("name", "email", "job_title", "team_id", "active", "role"):
        if field in data:
            setattr(user, field, data[field])

    db.commit()
    db.refresh(user)
    return UserItem.model_validate(user)
