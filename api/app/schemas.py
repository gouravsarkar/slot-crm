from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class ActIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    segments_requested: int = Field(ge=1, le=36)
    notes: str | None = None
    preferred_slot_ids: list[int] = []


class RequestIn(BaseModel):
    event_id: int
    group_name: str = Field(min_length=1, max_length=200)
    contact_name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    phone: str | None = None
    group_notes: str | None = None
    acts: list[ActIn] = Field(min_length=1, max_length=20)


class RequestPatch(BaseModel):
    status: Literal["submitted", "under_review", "assigned", "declined", "cancelled"] | None = None
    payment_status: Literal["pending", "paid"] | None = None
    admin_notes: str | None = None


class AssignmentIn(BaseModel):
    act_id: int
    slot_ids: list[int] = Field(min_length=1)


class AssignJobIn(BaseModel):
    request_id: int
    assignments: list[AssignmentIn] = Field(min_length=1)
    requested_by: str = "admin"


class UnassignJobIn(BaseModel):
    act_ids: list[int] = Field(min_length=1)
    requested_by: str = "admin"


class SuggestJobIn(BaseModel):
    requested_by: str = "admin"


class EventIn(BaseModel):
    name: str = Field(min_length=1)
    venue: str | None = None
    slot_minutes: int = Field(default=10, ge=1, le=120)


class DayIn(BaseModel):
    event_date: str  # YYYY-MM-DD
    label: str | None = None


class DayPatch(BaseModel):
    event_date: str | None = None
    label: str | None = None
