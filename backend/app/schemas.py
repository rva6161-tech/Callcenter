"""Pydantic models for auth and basic read models."""
import re
from datetime import date, datetime
from typing import Dict, List, Optional

import email_validator
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

VALID_ROLES = {"admin", "supervisor", "agent"}

# All sample/seed accounts use the reserved `.test` TLD (RFC 2606), which
# email-validator rejects as a special-use domain by default. Allow it so those
# accounts can be validated and logged in with.
if "test" in email_validator.SPECIAL_USE_DOMAIN_NAMES:
    email_validator.SPECIAL_USE_DOMAIN_NAMES.remove("test")


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: EmailStr
    role: str
    team_id: Optional[int] = None
    job_title: Optional[str] = None
    active: bool
    created_at: datetime


class UserPublic(BaseModel):
    """Compact user info embedded in the login response."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: EmailStr
    role: str
    team_id: Optional[int] = None


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


# --------------------------------------------------------------------------- #
# Phase 2 — Team management (teams + users CRUD)
# --------------------------------------------------------------------------- #


class SupervisorSummary(BaseModel):
    """Compact supervisor info embedded in team responses."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: EmailStr


class TeamAgent(BaseModel):
    """An agent (team member) in the team-detail response."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: EmailStr
    job_title: Optional[str] = None
    active: bool


class TeamListItem(BaseModel):
    """Team summary row for GET /api/teams."""
    id: int
    name: str
    description: Optional[str] = None
    active: bool
    agent_count: int
    supervisor: Optional[SupervisorSummary] = None


class TeamDetail(BaseModel):
    """Full team detail for GET /api/teams/{id}."""
    id: int
    name: str
    description: Optional[str] = None
    active: bool
    supervisor: Optional[SupervisorSummary] = None
    agents: List[TeamAgent] = []


class TeamCreate(BaseModel):
    name: str = Field(..., min_length=1)
    description: Optional[str] = None


class TeamUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1)
    description: Optional[str] = None
    supervisor_id: Optional[int] = None
    active: Optional[bool] = None


class UserItem(BaseModel):
    """User row for user list / create / update responses (no password_hash)."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: EmailStr
    role: str
    job_title: Optional[str] = None
    team_id: Optional[int] = None
    active: bool


class UserCreate(BaseModel):
    name: str = Field(..., min_length=1)
    email: EmailStr
    job_title: Optional[str] = None
    team_id: Optional[int] = None
    role: str = "agent"
    password: str = "Password123!"

    @field_validator("role")
    @classmethod
    def _check_role(cls, v: str) -> str:
        if v not in VALID_ROLES:
            raise ValueError("role must be one of admin, supervisor, agent")
        return v


class UserUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1)
    email: Optional[EmailStr] = None
    job_title: Optional[str] = None
    team_id: Optional[int] = None
    active: Optional[bool] = None
    role: Optional[str] = None

    @field_validator("role")
    @classmethod
    def _check_role(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_ROLES:
            raise ValueError("role must be one of admin, supervisor, agent")
        return v


# --------------------------------------------------------------------------- #
# Phase 3 — Shift types + weekly schedule engine
# --------------------------------------------------------------------------- #

_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _check_hhmm(v: Optional[str]) -> Optional[str]:
    """Validate a 24h 'HH:MM' time string (None passes through)."""
    if v is None:
        return v
    if not isinstance(v, str) or not _HHMM.match(v):
        raise ValueError("time must be in 'HH:MM' 24h format")
    return v


class ShiftTypeOut(BaseModel):
    """A shift type with times rendered as 'HH:MM'."""
    id: int
    name: str
    start_time: str
    end_time: str
    break_start: Optional[str] = None
    break_end: Optional[str] = None
    lunch_start: Optional[str] = None
    lunch_end: Optional[str] = None


class ShiftTypeCreate(BaseModel):
    name: str = Field(..., min_length=1)
    start_time: str
    end_time: str
    break_start: Optional[str] = None
    break_end: Optional[str] = None
    lunch_start: Optional[str] = None
    lunch_end: Optional[str] = None

    @field_validator(
        "start_time", "end_time", "break_start", "break_end", "lunch_start", "lunch_end"
    )
    @classmethod
    def _v_time(cls, v: Optional[str]) -> Optional[str]:
        return _check_hhmm(v)


class ShiftTypeUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1)
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    break_start: Optional[str] = None
    break_end: Optional[str] = None
    lunch_start: Optional[str] = None
    lunch_end: Optional[str] = None

    @field_validator(
        "start_time", "end_time", "break_start", "break_end", "lunch_start", "lunch_end"
    )
    @classmethod
    def _v_time(cls, v: Optional[str]) -> Optional[str]:
        return _check_hhmm(v)


class AssignmentOut(BaseModel):
    """A single scheduled cell."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    agent_id: int
    work_date: date
    shift_type_id: Optional[int] = None
    is_day_off: bool


class AssignmentSaved(AssignmentOut):
    """Upsert response: the saved cell plus any non-blocking warnings."""
    warnings: List[str] = []


class AssignmentUpsert(BaseModel):
    team_id: int
    week_start: date
    agent_id: int
    work_date: date
    shift_type_id: Optional[int] = None
    is_day_off: bool = False


class ScheduleTeam(BaseModel):
    id: int
    name: str


class ScheduleAgent(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    job_title: Optional[str] = None


class ScheduleGrid(BaseModel):
    """Full weekly grid payload for GET /api/schedule."""
    team: ScheduleTeam
    week_start: date
    week_dates: List[date]
    status: str
    published_at: Optional[datetime] = None
    shift_types: List[ShiftTypeOut]
    agents: List[ScheduleAgent]
    assignments: List[AssignmentOut]
    day_counts: Dict[str, int]


class CopyLastWeekRequest(BaseModel):
    team_id: int
    week_start: date


# --------------------------------------------------------------------------- #
# Phase 4 — Publishing + agent "my schedule"
# --------------------------------------------------------------------------- #


class PublishRequest(BaseModel):
    team_id: int
    week_start: date


class PublishResponse(BaseModel):
    """Result of publish / unpublish — the week's new status."""
    team_id: int
    week_start: date
    status: str
    published_at: Optional[datetime] = None


class MyScheduleShift(BaseModel):
    """One day's cell in the agent-facing view."""
    work_date: date
    is_day_off: bool
    shift_type: Optional[ShiftTypeOut] = None


class MyScheduleOut(BaseModel):
    """The logged-in agent's own shifts for a week (published weeks only)."""
    week_start: date
    week_dates: List[date]
    published: bool
    status: str
    published_at: Optional[datetime] = None
    shifts: List[MyScheduleShift] = []
