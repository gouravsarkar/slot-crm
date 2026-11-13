import datetime as dt
import logging
import secrets
import uuid
from contextlib import asynccontextmanager

import psycopg.errors as pgerr
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query
from psycopg.types.json import Jsonb

from . import db
from .config import ADMIN_TOKEN
from .queues import close_queues, enqueue_allocation, enqueue_notification
from .schemas import (AssignJobIn, DayIn, DayPatch, EventIn, RequestIn,
                      RequestPatch, SuggestJobIn, UnassignJobIn)

log = logging.getLogger("api")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.open_pool()
    yield
    await close_queues()
    await db.close_pool()


app = FastAPI(title="Slot booking CRM", lifespan=lifespan)


def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    if not x_admin_token or not secrets.compare_digest(x_admin_token, ADMIN_TOKEN):
        raise HTTPException(status_code=401, detail="Admin token required")


public = APIRouter(prefix="/api")
admin = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])


async def fetch_all(conn, sql: str, params=None) -> list[dict]:
    cur = await conn.execute(sql, params)
    return await cur.fetchall()


async def fetch_one(conn, sql: str, params=None) -> dict | None:
    cur = await conn.execute(sql, params)
    return await cur.fetchone()


@app.get("/health")
async def health(conn=Depends(db.get_conn)):
    await conn.execute("SELECT 1")
    return {"ok": True}


# --------------------------------------------------------------- public

@public.get("/events")
async def list_events(conn=Depends(db.get_conn)):
    return await fetch_all(conn, "SELECT id, name, venue, slot_minutes FROM events ORDER BY id DESC")


@public.get("/events/{event_id}")
async def get_event(event_id: int, conn=Depends(db.get_conn)):
    event = await fetch_one(conn, "SELECT id, name, venue, slot_minutes FROM events WHERE id=%s", (event_id,))
    if not event:
        raise HTTPException(404, "Event not found")
    event["days"] = await fetch_all(
        conn, "SELECT id, event_date, label FROM event_days WHERE event_id=%s ORDER BY event_date", (event_id,))
    event["bands"] = await fetch_all(
        conn, "SELECT id, code, label, start_time, end_time FROM time_bands WHERE event_id=%s ORDER BY sort_order",
        (event_id,))
    return event


@public.get("/events/{event_id}/slots")
async def event_slots(event_id: int, conn=Depends(db.get_conn)):
    """Segment grid with a taken flag only (no group names on the public side)."""
    return await fetch_all(conn, """
        SELECT s.id, s.event_day_id AS day_id, d.event_date, b.code AS band,
               s.start_time, s.end_time, (sa.slot_id IS NOT NULL) AS taken
        FROM slots s
        JOIN event_days d ON d.id = s.event_day_id
        JOIN time_bands b ON b.id = s.band_id
        LEFT JOIN slot_assignments sa ON sa.slot_id = s.id
        WHERE d.event_id = %s
        ORDER BY d.event_date, s.start_time""", (event_id,))


@public.post("/requests", status_code=201)
async def create_request(body: RequestIn, conn=Depends(db.get_conn)):
    if not await fetch_one(conn, "SELECT 1 AS x FROM events WHERE id=%s", (body.event_id,)):
        raise HTTPException(404, "Event not found")

    pref_ids = sorted({sid for act in body.acts for sid in act.preferred_slot_ids})
    if pref_ids:
        valid = await fetch_one(conn, """
            SELECT count(*) AS n FROM slots s JOIN event_days d ON d.id = s.event_day_id
            WHERE s.id = ANY(%s) AND d.event_id = %s""", (pref_ids, body.event_id))
        if valid["n"] != len(pref_ids):
            raise HTTPException(422, "Some preferred segments do not belong to this event")

    group = await fetch_one(conn, """
        INSERT INTO groups (name, contact_name, email, phone) VALUES (%s, %s, %s, %s)
        ON CONFLICT (lower(email), lower(name))
        DO UPDATE SET contact_name = EXCLUDED.contact_name,
                      phone = COALESCE(EXCLUDED.phone, groups.phone)
        RETURNING id""", (body.group_name, body.contact_name, body.email, body.phone))
    req = await fetch_one(conn, """
        INSERT INTO slot_requests (event_id, group_id, group_notes) VALUES (%s, %s, %s) RETURNING id""",
                          (body.event_id, group["id"], body.group_notes))
    act_ids = []
    for act in body.acts:
        row = await fetch_one(conn, """
            INSERT INTO acts (request_id, name, segments_requested, notes) VALUES (%s, %s, %s, %s) RETURNING id""",
                              (req["id"], act.name, act.segments_requested, act.notes))
        act_ids.append(row["id"])
        for sid in sorted(set(act.preferred_slot_ids)):
            await conn.execute("INSERT INTO act_preferences (act_id, slot_id) VALUES (%s, %s)", (row["id"], sid))
    await conn.commit()  # worker must see the rows before it is notified
    await enqueue_notification("request_received", {"request_id": req["id"]})
    return {"request_id": req["id"], "act_ids": act_ids}


# ---------------------------------------------------------------- admin

@admin.get("/requests")
async def admin_list_requests(event_id: int | None = None, status: str | None = None,
                              conn=Depends(db.get_conn)):
    return await fetch_all(conn, """
        SELECT r.id, r.event_id, r.status, r.payment_status, r.submitted_at,
               g.name AS group_name, g.contact_name, g.email,
               count(a.id) AS acts,
               COALESCE(sum(a.segments_requested), 0)::int AS segments_requested,
               (SELECT count(*) FROM slot_assignments sa JOIN acts a2 ON a2.id = sa.act_id
                 WHERE a2.request_id = r.id)::int AS segments_assigned
        FROM slot_requests r
        JOIN groups g ON g.id = r.group_id
        LEFT JOIN acts a ON a.request_id = r.id
        WHERE (%(event_id)s::int IS NULL OR r.event_id = %(event_id)s)
          AND (%(status)s::text IS NULL OR r.status = %(status)s::request_status)
        GROUP BY r.id, g.id
        ORDER BY r.submitted_at DESC""", {"event_id": event_id, "status": status})


@admin.get("/requests/{request_id}")
async def admin_get_request(request_id: int, conn=Depends(db.get_conn)):
    req = await fetch_one(conn, """
        SELECT r.*, g.name AS group_name, g.contact_name, g.email, g.phone
        FROM slot_requests r JOIN groups g ON g.id = r.group_id WHERE r.id = %s""", (request_id,))
    if not req:
        raise HTTPException(404, "Request not found")
    acts = await fetch_all(conn, "SELECT id, name, segments_requested, notes FROM acts WHERE request_id=%s ORDER BY id",
                           (request_id,))
    ids = [a["id"] for a in acts]
    prefs = await fetch_all(conn, """
        SELECT p.act_id, s.id AS slot_id, s.event_day_id AS day_id, s.start_time, b.code AS band
        FROM act_preferences p JOIN slots s ON s.id = p.slot_id JOIN time_bands b ON b.id = s.band_id
        WHERE p.act_id = ANY(%s) ORDER BY s.event_day_id, s.start_time""", (ids,))
    assigned = await fetch_all(conn, """
        SELECT sa.act_id, s.id AS slot_id, s.event_day_id AS day_id, s.start_time, b.code AS band
        FROM slot_assignments sa JOIN slots s ON s.id = sa.slot_id JOIN time_bands b ON b.id = s.band_id
        WHERE sa.act_id = ANY(%s) ORDER BY s.event_day_id, s.start_time""", (ids,))
    for a in acts:
        a["preferred"] = [p for p in prefs if p["act_id"] == a["id"]]
        a["assigned"] = [p for p in assigned if p["act_id"] == a["id"]]
    req["acts"] = acts
    return req


@admin.patch("/requests/{request_id}")
async def admin_patch_request(request_id: int, body: RequestPatch, conn=Depends(db.get_conn)):
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(422, "Nothing to update")
    casts = {"status": "%(status)s::request_status", "payment_status": "%(payment_status)s::payment_status",
             "admin_notes": "%(admin_notes)s"}
    sets = ", ".join(f"{col} = {casts[col]}" for col in changes) + ", updated_at = now()"
    row = await fetch_one(conn, f"UPDATE slot_requests SET {sets} WHERE id = %(id)s RETURNING id, status, payment_status",
                          {**changes, "id": request_id})
    if not row:
        raise HTTPException(404, "Request not found")
    if changes.get("status") in ("declined", "cancelled"):  # free the segments
        await conn.execute(
            "DELETE FROM slot_assignments WHERE act_id IN (SELECT id FROM acts WHERE request_id = %s)", (request_id,))
    await conn.commit()
    if changes.get("status") == "declined":
        await enqueue_notification("declined", {"request_id": request_id})
    return row


@admin.get("/grid")
async def admin_grid(event_id: int = Query(...), conn=Depends(db.get_conn)):
    return await fetch_all(conn, """
        SELECT s.id AS slot_id, s.event_day_id AS day_id, d.event_date, d.label AS day_label,
               b.code AS band, s.start_time, s.end_time,
               sa.act_id, a.name AS act_name, r.id AS request_id, g.name AS group_name, r.payment_status
        FROM slots s
        JOIN event_days d ON d.id = s.event_day_id
        JOIN time_bands b ON b.id = s.band_id
        LEFT JOIN slot_assignments sa ON sa.slot_id = s.id
        LEFT JOIN acts a ON a.id = sa.act_id
        LEFT JOIN slot_requests r ON r.id = a.request_id
        LEFT JOIN groups g ON g.id = r.group_id
        WHERE d.event_id = %s
        ORDER BY d.event_date, s.start_time""", (event_id,))


# ---- queued allocation work (executed one at a time by the Node worker)

async def create_job(conn, kind: str, request_id: int, payload: dict, requested_by: str) -> str:
    row = await fetch_one(conn, """
        INSERT INTO allocation_jobs (kind, request_id, payload, requested_by) VALUES (%s, %s, %s, %s) RETURNING id""",
                          (kind, request_id, Jsonb(payload), requested_by))
    await conn.commit()
    job_id = str(row["id"])
    try:
        await enqueue_allocation(kind, job_id, {"job_id": job_id, **payload})
    except Exception as exc:  # noqa: BLE001
        await conn.execute("UPDATE allocation_jobs SET status='failed', error=%s, finished_at=now() WHERE id=%s",
                           (f"Could not enqueue: {exc}", job_id))
        await conn.commit()
        raise HTTPException(503, "Queue unavailable") from exc
    return job_id


@admin.post("/requests/{request_id}/assign", status_code=202)
async def queue_assign(request_id: int, body: AssignJobIn, conn=Depends(db.get_conn)):
    if body.request_id != request_id:
        raise HTTPException(422, "request_id mismatch")
    act_ids = [a.act_id for a in body.assignments]
    if len(set(act_ids)) != len(act_ids):
        raise HTTPException(422, "Each act may appear once")
    ok = await fetch_one(conn, "SELECT count(*) AS n FROM acts WHERE id = ANY(%s) AND request_id = %s",
                         (act_ids, request_id))
    if ok["n"] != len(act_ids):
        raise HTTPException(422, "Acts do not belong to this request")
    slot_ids = [s for a in body.assignments for s in a.slot_ids]
    ok = await fetch_one(conn, """
        SELECT count(DISTINCT s.id) AS n FROM slots s JOIN event_days d ON d.id = s.event_day_id
        WHERE s.id = ANY(%s) AND d.event_id = (SELECT event_id FROM slot_requests WHERE id = %s)""",
                         (slot_ids, request_id))
    if ok["n"] != len(set(slot_ids)) or len(set(slot_ids)) != len(slot_ids):
        raise HTTPException(422, "Invalid or duplicate segments for this event")
    payload = {"request_id": request_id, "assigned_by": body.requested_by,
               "assignments": [a.model_dump() for a in body.assignments]}
    return {"job_id": await create_job(conn, "assign", request_id, payload, body.requested_by)}


@admin.post("/requests/{request_id}/unassign", status_code=202)
async def queue_unassign(request_id: int, body: UnassignJobIn, conn=Depends(db.get_conn)):
    ok = await fetch_one(conn, "SELECT count(*) AS n FROM acts WHERE id = ANY(%s) AND request_id = %s",
                         (body.act_ids, request_id))
    if ok["n"] != len(set(body.act_ids)):
        raise HTTPException(422, "Acts do not belong to this request")
    payload = {"request_id": request_id, "act_ids": body.act_ids}
    return {"job_id": await create_job(conn, "unassign", request_id, payload, body.requested_by)}


@admin.post("/requests/{request_id}/suggest", status_code=202)
async def queue_suggest(request_id: int, body: SuggestJobIn, conn=Depends(db.get_conn)):
    if not await fetch_one(conn, "SELECT 1 AS x FROM slot_requests WHERE id=%s", (request_id,)):
        raise HTTPException(404, "Request not found")
    return {"job_id": await create_job(conn, "suggest", request_id, {"request_id": request_id}, body.requested_by)}


@admin.get("/jobs/{job_id}")
async def get_job(job_id: str, conn=Depends(db.get_conn)):
    try:
        uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(404, "Job not found")
    row = await fetch_one(conn, """
        SELECT id, kind, request_id, status, result, error, created_at, started_at, finished_at
        FROM allocation_jobs WHERE id = %s""", (job_id,))
    if not row:
        raise HTTPException(404, "Job not found")
    return row


# ------------------------------------------------- event / date management

@admin.post("/events", status_code=201)
async def create_event(body: EventIn, conn=Depends(db.get_conn)):
    row = await fetch_one(conn, "INSERT INTO events (name, venue, slot_minutes) VALUES (%s, %s, %s) RETURNING id",
                          (body.name, body.venue, body.slot_minutes))
    await conn.execute("SELECT create_default_bands(%s::smallint)", (row["id"],))
    await conn.commit()
    return row


def _parse_date(value: str) -> dt.date:
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        raise HTTPException(422, "event_date must be YYYY-MM-DD")


@admin.post("/events/{event_id}/days", status_code=201)
async def add_day(event_id: int, body: DayIn, conn=Depends(db.get_conn)):
    date = _parse_date(body.event_date)
    try:
        row = await fetch_one(conn, """
            INSERT INTO event_days (event_id, event_date, label) VALUES (%s, %s, %s) RETURNING id""",
                              (event_id, date, body.label or date.strftime("%A")))
    except pgerr.UniqueViolation:
        await conn.rollback()
        raise HTTPException(409, "That date already exists for this event")
    except pgerr.ForeignKeyViolation:
        await conn.rollback()
        raise HTTPException(404, "Event not found")
    await conn.execute("SELECT generate_slots(%s::smallint)", (row["id"],))
    await conn.commit()
    return row


@admin.patch("/days/{day_id}")
async def patch_day(day_id: int, body: DayPatch, conn=Depends(db.get_conn)):
    changes = body.model_dump(exclude_unset=True)
    if "event_date" in changes:
        changes["event_date"] = _parse_date(changes["event_date"])
    if not changes:
        raise HTTPException(422, "Nothing to update")
    sets = ", ".join(f"{col} = %({col})s" for col in changes)
    try:
        row = await fetch_one(conn, f"UPDATE event_days SET {sets} WHERE id = %(id)s RETURNING id, event_date, label",
                              {**changes, "id": day_id})
    except pgerr.UniqueViolation:
        await conn.rollback()
        raise HTTPException(409, "That date already exists for this event")
    if not row:
        raise HTTPException(404, "Day not found")
    await conn.commit()
    return row


@admin.delete("/days/{day_id}", status_code=204)
async def delete_day(day_id: int, conn=Depends(db.get_conn)):
    try:
        await conn.execute("DELETE FROM event_days WHERE id = %s", (day_id,))
    except pgerr.ForeignKeyViolation:
        await conn.rollback()
        raise HTTPException(409, "Segments on this day are assigned; unassign them first")
    await conn.commit()


app.include_router(public)
app.include_router(admin)
