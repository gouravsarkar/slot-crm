-- Audit trail and status for queued allocation work (assign / unassign / suggest).
-- The API inserts a row and enqueues a Redis job with the same id; the Node worker
-- updates the row. The admin UI polls this table through the API.

CREATE TYPE job_status AS ENUM ('queued', 'running', 'done', 'failed');

CREATE TABLE allocation_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          TEXT NOT NULL CHECK (kind IN ('assign', 'unassign', 'suggest')),
  request_id    BIGINT REFERENCES slot_requests(id) ON DELETE SET NULL,
  payload       JSONB NOT NULL,
  status        job_status NOT NULL DEFAULT 'queued',
  result        JSONB,
  error         TEXT,
  requested_by  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ
);
CREATE INDEX allocation_jobs_request_idx ON allocation_jobs (request_id, created_at DESC);
