"""Participant portal: public, no login.

POST /api/portal/requests  book a slot (same tables as the request form; phone is mandatory)
POST /api/portal/lookup    see your bookings by email + phone number

Email + phone together act as the proof of identity for the lookup, so:
 * both come in the POST body (never the URL),
 * a miss gives one generic message (no hint whether the email or the phone was wrong),
 * attempts per email are throttled,
 * organiser-only fields (admin notes, other groups) are never returned.
"""
import re
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from . import db
from .booking import save_request
from .schemas import RequestIn

router = APIRouter(prefix="/api/portal")

MIN_PHONE_DIGITS = 7
NOT_FOUND = "We could not find a booking for that email address and phone number."

# Lookup throttle: per email, in memory (one API process). Enough to stop guessing phone numbers.
LOOKUP_LIMIT = 10
LOOKUP_WINDOW_S = 15 * 60
_attempts: dict[str, deque] = defaultdict(deque)


def _digits(phone: str) -> str:
    return re.sub(r"\D", "", phone)


def _throttle(email: str) -> None:
    now = time.monotonic()
    q = _attempts[email]
    while q and now - q[0] > LOOKUP_WINDOW_S:
        q.popleft()
    if len(q) >= LOOKUP_LIMIT:
        raise HTTPException(429, "Too many attempts. Please wait 15 minutes and try again.")
    q.append(now)


class PortalRequestIn(RequestIn):
    phone: str = Field(min_length=MIN_PHONE_DIGITS, max_length=30)

    @field_validator("phone")
    @classmethod
    def phone_has_digits(cls, v: str) -> str:
        v = v.strip()
        if len(_digits(v)) < MIN_PHONE_DIGITS:
            raise ValueError(f"Phone number must have at least {MIN_PHONE_DIGITS} digits")
        return v


@router.post("/requests", status_code=201)
async def book(body: PortalRequestIn, conn=Depends(db.get_conn)):
    return await save_request(conn, body)


class LookupIn(BaseModel):
    email: str = Field(max_length=254)
    phone: str = Field(max_length=30)


@router.post("/lookup")
async def lookup(body: LookupIn, conn=Depends(db.get_conn)):
    email = body.email.strip().lower()
    digits = _digits(body.phone)
    if not email or len(digits) < MIN_PHONE_DIGITS:
        raise HTTPException(422, "Enter the email address and phone number used for the booking.")
    _throttle(email)

    # Phone matches on digits only; the last 10 digits also match, so 07700 900123 == +44 7700 900123.
    cur = await conn.execute("""
        SELECT id FROM groups
        WHERE lower(email) = %(email)s AND phone IS NOT NULL
          AND (regexp_replace(phone, '\\D', '', 'g') = %(digits)s
               OR (length(%(digits)s) >= 10
                   AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = right(%(digits)s, 10)))""",
                             {"email": email, "digits": digits})
    group_ids = [r["id"] for r in await cur.fetchall()]
    if not group_ids:
        raise HTTPException(404, NOT_FOUND)

    cur = await conn.execute("""
        SELECT r.id, r.status, r.payment_status, r.submitted_at, r.group_notes,
               g.name AS group_name, g.contact_name, g.email, g.phone,
               e.name AS event_name, e.venue, e.slot_minutes
        FROM slot_requests r
        JOIN groups g ON g.id = r.group_id
        JOIN events e ON e.id = r.event_id
        WHERE r.group_id = ANY(%s)
        ORDER BY r.submitted_at DESC""", (group_ids,))
    requests = await cur.fetchall()
    if not requests:
        raise HTTPException(404, NOT_FOUND)

    cur = await conn.execute("""
        SELECT a.id, a.request_id, a.name, a.segments_requested, a.notes,
               count(sa.slot_id)::int AS segments_assigned,
               min(d.event_date) AS event_date, min(d.label) AS day_label,
               min(s.start_time) AS start_time, max(s.end_time) AS end_time,
               coalesce(array_agg(DISTINCT b.code) FILTER (WHERE b.code IS NOT NULL), '{}') AS bands,
               (SELECT count(*) FROM act_preferences p WHERE p.act_id = a.id)::int AS preferences
        FROM acts a
        LEFT JOIN slot_assignments sa ON sa.act_id = a.id
        LEFT JOIN slots s ON s.id = sa.slot_id
        LEFT JOIN event_days d ON d.id = s.event_day_id
        LEFT JOIN time_bands b ON b.id = s.band_id
        WHERE a.request_id = ANY(%s)
        GROUP BY a.id ORDER BY a.id""", ([r["id"] for r in requests],))
    acts = await cur.fetchall()
    for r in requests:
        r["acts"] = [a for a in acts if a["request_id"] == r["id"]]
    return {"requests": requests}
