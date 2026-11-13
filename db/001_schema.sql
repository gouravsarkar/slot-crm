-- Performance slot booking CRM (single stage), Postgres
-- Model: groups send a request containing one or more ACTs; each ACT asks for
-- N ten-minute segments and lists preferred segments. Admins assign segments
-- to ACTs. Segments of one ACT must be back-to-back on one day; different ACTs
-- of the same group can sit on any day / band.

CREATE TYPE request_status AS ENUM (
  'submitted', 'under_review', 'assigned', 'declined', 'cancelled'
);

-- Visual indicator only: never blocks assignment.
CREATE TYPE payment_status AS ENUM ('pending', 'paid');

-- Event editions ---------------------------------------------------------
CREATE TABLE events (
  id            SMALLSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,                     -- e.g. 'Manchester April 2027'
  venue         TEXT,
  slot_minutes  SMALLINT NOT NULL DEFAULT 10 CHECK (slot_minutes > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dates are plain data: change them with UPDATE, add or remove days freely.
-- Slots point at the day row, so moving a date never touches assignments.
CREATE TABLE event_days (
  id          SMALLSERIAL PRIMARY KEY,
  event_id    SMALLINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  event_date  DATE NOT NULL,
  label       TEXT,                                -- e.g. 'Saturday'
  UNIQUE (event_id, event_date)
);

-- Colour bands are per event so times can be changed later.
CREATE TABLE time_bands (
  id          SMALLSERIAL PRIMARY KEY,
  event_id    SMALLINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,                       -- GREEN / PURPLE / PINK
  label       TEXT NOT NULL,
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  sort_order  SMALLINT NOT NULL DEFAULT 0,
  UNIQUE (event_id, code),
  CHECK (end_time > start_time)
);

-- One row per segment
CREATE TABLE slots (
  id            BIGSERIAL PRIMARY KEY,
  event_day_id  SMALLINT NOT NULL REFERENCES event_days(id) ON DELETE CASCADE,
  band_id       SMALLINT NOT NULL REFERENCES time_bands(id),
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  UNIQUE (event_day_id, start_time)
);

-- Creates default GREEN / PURPLE / PINK bands for an event (edit afterwards if needed)
CREATE FUNCTION create_default_bands(p_event_id SMALLINT) RETURNS VOID
LANGUAGE sql AS $$
  INSERT INTO time_bands (event_id, code, label, start_time, end_time, sort_order) VALUES
    (p_event_id, 'GREEN',  'Morning',   '11:00', '13:00', 1),
    (p_event_id, 'PURPLE', 'Afternoon', '14:00', '16:00', 2),
    (p_event_id, 'PINK',   'Evening',   '16:00', '18:00', 3)
  ON CONFLICT (event_id, code) DO NOTHING;
$$;

-- Idempotent: creates any missing segments for a day from the event's bands.
-- Run after adding a day or changing band times (existing segments are kept).
CREATE FUNCTION generate_slots(p_day_id SMALLINT) RETURNS VOID
LANGUAGE sql AS $$
  INSERT INTO slots (event_day_id, band_id, start_time, end_time)
  SELECT d.id,
         b.id,
         t::time,
         (t + make_interval(mins => e.slot_minutes))::time
  FROM event_days d
  JOIN events e ON e.id = d.event_id
  JOIN time_bands b ON b.event_id = e.id
  CROSS JOIN LATERAL generate_series(
    timestamp '2000-01-01' + b.start_time,
    timestamp '2000-01-01' + b.end_time - make_interval(mins => e.slot_minutes),
    make_interval(mins => e.slot_minutes)
  ) AS t
  WHERE d.id = p_day_id
  ON CONFLICT (event_day_id, start_time) DO NOTHING;
$$;

-- Contacts and requests --------------------------------------------------
CREATE TABLE groups (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  contact_name  TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX groups_email_name_uq ON groups (lower(email), lower(name));

CREATE TABLE slot_requests (
  id              BIGSERIAL PRIMARY KEY,
  event_id        SMALLINT NOT NULL REFERENCES events(id),
  group_id        BIGINT NOT NULL REFERENCES groups(id),
  status          request_status NOT NULL DEFAULT 'submitted',
  payment_status  payment_status NOT NULL DEFAULT 'pending',
  group_notes     TEXT,
  admin_notes     TEXT,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One performance item within a request
CREATE TABLE acts (
  id                  BIGSERIAL PRIMARY KEY,
  request_id          BIGINT NOT NULL REFERENCES slot_requests(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,               -- e.g. 'Adult Dance'
  segments_requested  SMALLINT NOT NULL CHECK (segments_requested >= 1),
  notes               TEXT
);

-- Segments the group would like for an act (preferences only)
CREATE TABLE act_preferences (
  act_id   BIGINT NOT NULL REFERENCES acts(id) ON DELETE CASCADE,
  slot_id  BIGINT NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  PRIMARY KEY (act_id, slot_id)
);

-- Assignments -----------------------------------------------------------
-- PRIMARY KEY on slot_id: one segment can belong to at most one act.
CREATE TABLE slot_assignments (
  slot_id      BIGINT PRIMARY KEY REFERENCES slots(id),
  act_id       BIGINT NOT NULL REFERENCES acts(id) ON DELETE CASCADE,
  assigned_by  TEXT NOT NULL,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX slot_assignments_act_idx ON slot_assignments (act_id);

-- Rule checked at COMMIT for every act that has assignments:
--   * number of assigned segments = segments_requested
--   * all on the same day, same event as the request
--   * back-to-back (no gaps), so an act cannot jump over the lunch break
--     between GREEN and PURPLE, but can run PURPLE into PINK
CREATE FUNCTION check_act_assignment(p_act_id BIGINT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  n int; days int; foreign_slots int;
  mn time; mx time;
  want int; mins int; req_event int;
BEGIN
  SELECT a.segments_requested, e.slot_minutes, r.event_id
    INTO want, mins, req_event
  FROM acts a
  JOIN slot_requests r ON r.id = a.request_id
  JOIN events e ON e.id = r.event_id
  WHERE a.id = p_act_id;

  IF want IS NULL THEN RETURN; END IF;           -- act was deleted

  SELECT count(*),
         count(DISTINCT s.event_day_id),
         count(*) FILTER (WHERE d.event_id <> req_event),
         min(s.start_time),
         max(s.start_time)
    INTO n, days, foreign_slots, mn, mx
  FROM slot_assignments sa
  JOIN slots s ON s.id = sa.slot_id
  JOIN event_days d ON d.id = s.event_day_id
  WHERE sa.act_id = p_act_id;

  IF n = 0 THEN RETURN; END IF;                  -- unassigned is fine

  IF foreign_slots > 0 THEN
    RAISE EXCEPTION 'Act %: segments belong to a different event', p_act_id;
  END IF;
  IF n <> want THEN
    RAISE EXCEPTION 'Act %: % segments assigned but % requested', p_act_id, n, want;
  END IF;
  IF days <> 1 THEN
    RAISE EXCEPTION 'Act %: segments must be on the same day', p_act_id;
  END IF;
  IF (mx - mn) <> (n - 1) * make_interval(mins => mins) THEN
    RAISE EXCEPTION 'Act %: segments must be back-to-back', p_act_id;
  END IF;
END;
$$;

CREATE FUNCTION slot_assignments_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM check_act_assignment(NEW.act_id);
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.act_id <> NEW.act_id) THEN
    PERFORM check_act_assignment(OLD.act_id);
  END IF;
  RETURN NULL;
END;
$$;

-- Deferred, so an admin can insert all of an act's segments in one transaction
CREATE CONSTRAINT TRIGGER slot_assignments_contiguity
AFTER INSERT OR UPDATE OR DELETE ON slot_assignments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION slot_assignments_check();

-- Admin views -------------------------------------------------------------
CREATE VIEW schedule_grid AS
SELECT e.name AS event, d.event_date, d.label AS day, b.code AS band,
       s.id AS slot_id, s.start_time, s.end_time,
       g.name AS group_name, a.name AS act_name,
       r.id AS request_id, r.payment_status
FROM slots s
JOIN event_days d ON d.id = s.event_day_id
JOIN events e ON e.id = d.event_id
JOIN time_bands b ON b.id = s.band_id
LEFT JOIN slot_assignments sa ON sa.slot_id = s.id
LEFT JOIN acts a ON a.id = sa.act_id
LEFT JOIN slot_requests r ON r.id = a.request_id
LEFT JOIN groups g ON g.id = r.group_id
ORDER BY d.event_date, s.start_time;

CREATE VIEW slot_demand AS
SELECT s.id AS slot_id, d.event_date, s.start_time, b.code AS band,
       count(p.act_id) AS acts_wanting,
       (sa.slot_id IS NOT NULL) AS is_assigned
FROM slots s
JOIN event_days d ON d.id = s.event_day_id
JOIN time_bands b ON b.id = s.band_id
LEFT JOIN act_preferences p ON p.slot_id = s.id
LEFT JOIN slot_assignments sa ON sa.slot_id = s.id
GROUP BY s.id, d.event_date, s.start_time, b.code, sa.slot_id
ORDER BY d.event_date, s.start_time;

-- Per act: how many segments asked for vs assigned
CREATE VIEW act_status AS
SELECT a.id AS act_id, g.name AS group_name, a.name AS act_name,
       a.segments_requested,
       count(sa.slot_id) AS segments_assigned,
       r.payment_status, r.status AS request_status
FROM acts a
JOIN slot_requests r ON r.id = a.request_id
JOIN groups g ON g.id = r.group_id
LEFT JOIN slot_assignments sa ON sa.act_id = a.id
GROUP BY a.id, g.name, a.name, a.segments_requested, r.payment_status, r.status;

-- Setup example -------------------------------------------------------------
--   INSERT INTO events (name, venue) VALUES ('Manchester April 2027', '...');
--   SELECT create_default_bands(1::smallint);
--   INSERT INTO event_days (event_id, event_date, label)
--     VALUES (1, '<saturday date>', 'Saturday'), (1, '<sunday date>', 'Sunday');
--   SELECT generate_slots(id) FROM event_days WHERE event_id = 1;
--
-- If the dates change:   UPDATE event_days SET event_date = '<new>' WHERE id = 1;
-- Add a day:             INSERT INTO event_days ...; SELECT generate_slots(<id>::smallint);
-- Remove a day:          DELETE FROM event_days WHERE id = 3;  (fails while any of its
--                        segments are assigned, so unassign first)
--
-- Assign an act (one transaction; errors roll everything back):
--   BEGIN;
--   INSERT INTO slot_assignments (slot_id, act_id, assigned_by)
--   VALUES (11, 5, 'admin'), (12, 5, 'admin');
--   UPDATE slot_requests SET status = 'assigned', updated_at = now() WHERE id = 7;
--   COMMIT;
