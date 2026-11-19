"""Saving a slot request. Shared by the organisers' request form and the participant portal."""
from fastapi import HTTPException

from .queues import enqueue_notification
from .schemas import RequestIn


async def _one(conn, sql: str, params=None) -> dict | None:
    cur = await conn.execute(sql, params)
    return await cur.fetchone()


async def save_request(conn, body: RequestIn) -> dict:
    """Upserts the group, inserts the request with its acts and preferences, commits, then queues the
    'request received' email. Returns {request_id, act_ids}."""
    if not await _one(conn, "SELECT 1 AS x FROM events WHERE id=%s", (body.event_id,)):
        raise HTTPException(404, "Event not found")

    pref_ids = sorted({sid for act in body.acts for sid in act.preferred_slot_ids})
    if pref_ids:
        valid = await _one(conn, """
            SELECT count(*) AS n FROM slots s JOIN event_days d ON d.id = s.event_day_id
            WHERE s.id = ANY(%s) AND d.event_id = %s""", (pref_ids, body.event_id))
        if valid["n"] != len(pref_ids):
            raise HTTPException(422, "Some preferred segments do not belong to this event")

    group = await _one(conn, """
        INSERT INTO groups (name, contact_name, email, phone) VALUES (%s, %s, %s, %s)
        ON CONFLICT (lower(email), lower(name))
        DO UPDATE SET contact_name = EXCLUDED.contact_name,
                      phone = COALESCE(EXCLUDED.phone, groups.phone)
        RETURNING id""", (body.group_name, body.contact_name, body.email, body.phone))
    req = await _one(conn, """
        INSERT INTO slot_requests (event_id, group_id, group_notes) VALUES (%s, %s, %s) RETURNING id""",
                     (body.event_id, group["id"], body.group_notes))
    act_ids = []
    for act in body.acts:
        row = await _one(conn, """
            INSERT INTO acts (request_id, name, segments_requested, notes) VALUES (%s, %s, %s, %s) RETURNING id""",
                         (req["id"], act.name, act.segments_requested, act.notes))
        act_ids.append(row["id"])
        for sid in sorted(set(act.preferred_slot_ids)):
            await conn.execute("INSERT INTO act_preferences (act_id, slot_id) VALUES (%s, %s)", (row["id"], sid))
    await conn.commit()  # worker must see the rows before it is notified
    await enqueue_notification("request_received", {"request_id": req["id"]})
    return {"request_id": req["id"], "act_ids": act_ids}
