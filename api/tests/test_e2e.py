"""End-to-end test against a running stack (API + Postgres + Redis + Node worker).

    API_URL=http://localhost:8000 ADMIN_TOKEN=dev-admin-token pytest -q api/tests
"""
import os
import time

import httpx
import pytest

API = os.environ.get("API_URL", "http://localhost:8000")
H = {"X-Admin-Token": os.environ.get("ADMIN_TOKEN", "dev-admin-token")}

try:
    httpx.get(f"{API}/health", timeout=2).raise_for_status()
except Exception:  # noqa: BLE001
    pytest.skip("stack not running", allow_module_level=True)

c = httpx.Client(base_url=API, timeout=10)


def wait_job(job_id: str, timeout: float = 10) -> dict:
    end = time.time() + timeout
    while time.time() < end:
        job = c.get(f"/api/admin/jobs/{job_id}", headers=H).json()
        if job["status"] in ("done", "failed"):
            return job
        time.sleep(0.1)
    raise AssertionError(f"job {job_id} did not finish")


@pytest.fixture(scope="module")
def event():
    ev = c.post("/api/admin/events", json={"name": "E2E", "venue": "Stage"}, headers=H).json()
    days = [c.post(f"/api/admin/events/{ev['id']}/days", json={"event_date": d}, headers=H).json()
            for d in ("2027-04-03", "2027-04-04")]
    slots = c.get(f"/api/events/{ev['id']}/slots").json()
    return {"id": ev["id"], "days": days, "slots": slots}


def sid(event, day_idx, hhmm):
    day = event["days"][day_idx]["id"]
    return next(s["id"] for s in event["slots"] if s["day_id"] == day and s["start_time"].startswith(hhmm))


def make_request(event, name, acts):
    r = c.post("/api/requests", json={
        "event_id": event["id"], "group_name": name, "contact_name": "Contact",
        "email": f"{name.replace(' ', '').lower()}@example.org", "acts": acts})
    assert r.status_code == 201, r.text
    return r.json()


def test_admin_requires_token():
    assert c.get("/api/admin/requests").status_code == 401


def test_event_structure(event):
    assert len(event["slots"]) == 72  # 36 per day, two days
    detail = c.get(f"/api/events/{event['id']}").json()
    assert [b["code"] for b in detail["bands"]] == ["GREEN", "PURPLE", "PINK"]
    assert [d["label"] for d in detail["days"]] == ["Saturday", "Sunday"]


def test_suggest_assign_conflict_unassign(event):
    pref = [sid(event, 0, "11:00"), sid(event, 0, "11:10"), sid(event, 0, "14:00")]
    a = make_request(event, "Akhi Ghungroo", [
        {"name": "Adult Dance", "segments_requested": 2, "preferred_slot_ids": pref[:2]},
        {"name": "Dance Drama", "segments_requested": 1, "preferred_slot_ids": [pref[2]]},
        {"name": "Kids Dance", "segments_requested": 1, "preferred_slot_ids": []},
    ])

    # suggest
    job = wait_job(c.post(f"/api/admin/requests/{a['request_id']}/suggest", json={}, headers=H).json()["job_id"])
    assert job["status"] == "done", job
    props = {p["act_id"]: p for p in job["result"]["proposals"]}
    assert props[a["act_ids"][0]]["slot_ids"] == pref[:2]
    assert props[a["act_ids"][1]]["slot_ids"] == [pref[2]]
    assert not job["result"]["unplaced"]

    # apply the suggestion
    body = {"request_id": a["request_id"], "requested_by": "test",
            "assignments": [{"act_id": p["act_id"], "slot_ids": p["slot_ids"]} for p in props.values()]}
    job = wait_job(c.post(f"/api/admin/requests/{a['request_id']}/assign", json=body, headers=H).json()["job_id"])
    assert job["status"] == "done", job
    assert job["result"]["request_status"] == "assigned"
    detail = c.get(f"/api/admin/requests/{a['request_id']}", headers=H).json()
    assert detail["status"] == "assigned" and detail["payment_status"] == "pending"

    # a second group wants an already-taken segment -> job fails, nothing changes
    b = make_request(event, "Other Group", [{"name": "Solo", "segments_requested": 1}])
    body = {"request_id": b["request_id"], "assignments": [{"act_id": b["act_ids"][0], "slot_ids": [pref[0]]}]}
    job = wait_job(c.post(f"/api/admin/requests/{b['request_id']}/assign", json=body, headers=H).json()["job_id"])
    assert job["status"] == "failed" and "already assigned" in job["error"]

    # gap inside one act is rejected by the database rule
    body = {"request_id": b["request_id"],
            "assignments": [{"act_id": b["act_ids"][0], "slot_ids": [sid(event, 1, "12:00"), sid(event, 1, "12:20")]}]}
    job = wait_job(c.post(f"/api/admin/requests/{b['request_id']}/assign", json=body, headers=H).json()["job_id"])
    assert job["status"] == "failed"

    # payment flag is only an indicator
    r = c.patch(f"/api/admin/requests/{b['request_id']}", json={"payment_status": "paid"}, headers=H)
    assert r.json()["payment_status"] == "paid"

    # unassign one act of group A
    job = wait_job(c.post(f"/api/admin/requests/{a['request_id']}/unassign",
                          json={"act_ids": [a["act_ids"][0]]}, headers=H).json()["job_id"])
    assert job["status"] == "done" and job["result"]["released"] == 2
    detail = c.get(f"/api/admin/requests/{a['request_id']}", headers=H).json()
    assert detail["status"] == "under_review"


def test_concurrent_assignments_only_one_wins(event):
    target = [sid(event, 1, "15:50"), sid(event, 1, "16:00")]  # PURPLE into PINK is allowed
    reqs = [make_request(event, f"Racer {i}", [{"name": "Act", "segments_requested": 2}]) for i in range(4)]
    ids = []
    for r in reqs:
        body = {"request_id": r["request_id"], "assignments": [{"act_id": r["act_ids"][0], "slot_ids": target}]}
        ids.append(c.post(f"/api/admin/requests/{r['request_id']}/assign", json=body, headers=H).json()["job_id"])
    results = [wait_job(j) for j in ids]
    assert sorted(j["status"] for j in results) == ["done", "failed", "failed", "failed"]


def test_dates_are_dynamic(event):
    day = event["days"][1]["id"]
    r = c.patch(f"/api/admin/days/{day}", json={"event_date": "2027-04-18"}, headers=H)
    assert r.status_code == 200 and r.json()["event_date"] == "2027-04-18"
    # the Sunday has a winning assignment from the race test -> cannot be deleted
    assert c.delete(f"/api/admin/days/{day}", headers=H).status_code == 409
    # a fresh, empty day can be added and removed
    new = c.post(f"/api/admin/events/{event['id']}/days", json={"event_date": "2027-05-01"}, headers=H).json()
    assert c.delete(f"/api/admin/days/{new['id']}", headers=H).status_code == 204
