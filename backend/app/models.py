"""SQLAlchemy ORM models for the Callcenter scheduling app.

All tables live in the ``bw_callcenter_1`` schema.
"""
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship

from .config import DB_SCHEMA
from .database import Base

_SCHEMA = {"schema": DB_SCHEMA}


def _fk(target: str) -> str:
    """Build a schema-qualified foreign key target."""
    return f"{DB_SCHEMA}.{target}"


class Team(Base):
    __tablename__ = "teams"
    __table_args__ = _SCHEMA

    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)
    description = Column(Text)
    supervisor_id = Column(Integer, ForeignKey(_fk("users.id"), ondelete="SET NULL"), nullable=True)
    active = Column(Boolean, nullable=False, server_default="true")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    supervisor = relationship("User", foreign_keys=[supervisor_id], post_update=True)
    members = relationship("User", back_populates="team", foreign_keys="User.team_id")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "role IN ('admin','supervisor','agent')", name="ck_users_role"
        ),
        Index("ix_users_team_id", "team_id"),
        _SCHEMA,
    )

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False)
    job_title = Column(Text)
    team_id = Column(Integer, ForeignKey(_fk("teams.id"), ondelete="SET NULL"), nullable=True)
    active = Column(Boolean, nullable=False, server_default="true")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    team = relationship("Team", back_populates="members", foreign_keys=[team_id])


class ShiftType(Base):
    __tablename__ = "shift_types"
    __table_args__ = _SCHEMA

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    break_start = Column(Time)
    break_end = Column(Time)
    lunch_start = Column(Time)
    lunch_end = Column(Time)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class ScheduleWeek(Base):
    __tablename__ = "schedule_weeks"
    __table_args__ = (
        UniqueConstraint("team_id", "week_start_date", name="uq_week_team_date"),
        CheckConstraint(
            "status IN ('draft','published')", name="ck_week_status"
        ),
        Index("ix_schedule_weeks_team_id", "team_id"),
        _SCHEMA,
    )

    id = Column(Integer, primary_key=True)
    team_id = Column(Integer, ForeignKey(_fk("teams.id"), ondelete="CASCADE"), nullable=False)
    week_start_date = Column(Date, nullable=False)
    status = Column(String, nullable=False, server_default="draft")
    published_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(Integer, ForeignKey(_fk("users.id"), ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    team = relationship("Team")
    assignments = relationship(
        "ShiftAssignment", back_populates="schedule_week", cascade="all, delete-orphan"
    )


class ShiftAssignment(Base):
    __tablename__ = "shift_assignments"
    __table_args__ = (
        UniqueConstraint(
            "schedule_week_id", "agent_id", "work_date", name="uq_assignment_week_agent_date"
        ),
        Index("ix_shift_assignments_agent_id", "agent_id"),
        Index("ix_shift_assignments_work_date", "work_date"),
        _SCHEMA,
    )

    id = Column(Integer, primary_key=True)
    schedule_week_id = Column(
        Integer, ForeignKey(_fk("schedule_weeks.id"), ondelete="CASCADE"), nullable=False
    )
    agent_id = Column(Integer, ForeignKey(_fk("users.id"), ondelete="CASCADE"), nullable=False)
    work_date = Column(Date, nullable=False)
    shift_type_id = Column(
        Integer, ForeignKey(_fk("shift_types.id"), ondelete="SET NULL"), nullable=True
    )
    is_day_off = Column(Boolean, nullable=False, server_default="false")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    schedule_week = relationship("ScheduleWeek", back_populates="assignments")
    agent = relationship("User")
    shift_type = relationship("ShiftType")
