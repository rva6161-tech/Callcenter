"""Shift type routes (Phase 3).

Role scoping:
  - admin & supervisor: full access (list / add / edit).
  - agent:              no access (403).

Spec requires add + edit only — there is no delete endpoint.
Times are accepted and returned as 'HH:MM' (24h).
"""
from datetime import datetime, time
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ShiftType
from ..schemas import ShiftTypeCreate, ShiftTypeOut, ShiftTypeUpdate
from ..security import require_role

router = APIRouter(prefix="/api/shift-types", tags=["shift-types"])

# admin + supervisor may read and write shift types.
_rw = require_role("admin", "supervisor")


# --------------------------------------------------------------------------- #
# Time helpers (shared with the schedule router)
# --------------------------------------------------------------------------- #


def fmt_time(t: Optional[time]) -> Optional[str]:
    """Render a ``datetime.time`` as 'HH:MM' (or None)."""
    return t.strftime("%H:%M") if t is not None else None


def parse_time(s: Optional[str]) -> Optional[time]:
    """Parse an 'HH:MM' string into a ``datetime.time`` (or None)."""
    return datetime.strptime(s, "%H:%M").time() if s is not None else None


def shift_type_to_out(st: ShiftType) -> ShiftTypeOut:
    return ShiftTypeOut(
        id=st.id,
        name=st.name,
        start_time=fmt_time(st.start_time),
        end_time=fmt_time(st.end_time),
        break_start=fmt_time(st.break_start),
        break_end=fmt_time(st.break_end),
        lunch_start=fmt_time(st.lunch_start),
        lunch_end=fmt_time(st.lunch_end),
    )


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #


@router.get("", response_model=List[ShiftTypeOut], dependencies=[Depends(_rw)])
def list_shift_types(db: Session = Depends(get_db)):
    types = db.query(ShiftType).order_by(ShiftType.id).all()
    return [shift_type_to_out(t) for t in types]


@router.post(
    "",
    response_model=ShiftTypeOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_rw)],
)
def create_shift_type(payload: ShiftTypeCreate, db: Session = Depends(get_db)):
    st = ShiftType(
        name=payload.name,
        start_time=parse_time(payload.start_time),
        end_time=parse_time(payload.end_time),
        break_start=parse_time(payload.break_start),
        break_end=parse_time(payload.break_end),
        lunch_start=parse_time(payload.lunch_start),
        lunch_end=parse_time(payload.lunch_end),
    )
    db.add(st)
    db.commit()
    db.refresh(st)
    return shift_type_to_out(st)


@router.put("/{shift_type_id}", response_model=ShiftTypeOut, dependencies=[Depends(_rw)])
def update_shift_type(
    shift_type_id: int, payload: ShiftTypeUpdate, db: Session = Depends(get_db)
):
    st = db.get(ShiftType, shift_type_id)
    if st is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Shift type not found"
        )

    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        st.name = data["name"]
    for field in ("start_time", "end_time", "break_start", "break_end", "lunch_start", "lunch_end"):
        if field in data:
            setattr(st, field, parse_time(data[field]))

    db.commit()
    db.refresh(st)
    return shift_type_to_out(st)
