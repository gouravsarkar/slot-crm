# Slot booking CRM

Performance-slot booking for a single-stage, two-day event. Groups submit requests
(acts + preferred 10-minute segments); admins assign segments.

| Part | Tech | Folder |
|---|---|---|
| Web app (request form + admin) | Next.js | `web/` |
| API | Python FastAPI | `api/` |
| Queue | Redis (BullMQ) | |
| Allocation + notification workers | Node.js | `worker/` |
| Database | PostgreSQL 16 | `db/` |

## Pages

| URL | Who | What |
|---|---|---|
| `/` | Groups (public) | Request form: acts and preferred segments |
| `/admin/report` | Admin | **Home**: view-only live slot report with the colour-coded stage schedule, summary figures, per-day schedule, requests still waiting, **Export PDF** |
| `/admin` | Admin | Review requests and assign segments |
| `/admin/settings` | Admin | Create events, set or change dates |

The Home report refreshes every 30 seconds. **Export PDF** downloads the current report
(summary, schedule for each day, and requests still waiting) as an A4 PDF, generated in the browser.

## Option A: Docker (easiest)

Needs Docker Desktop (or Docker Engine + Compose).

```bash
docker compose up --build
```

Then open:

- Request form: http://localhost:3000
- Admin: http://localhost:3000/admin (login `admin` / `change-me`)
- Event settings (create event, set dates): http://localhost:3000/admin/settings
- API docs: http://localhost:8000/docs
- Caught emails (dev): http://localhost:8025

First-time setup: go to **Admin > Event settings**, create an event, then add its
Saturday and Sunday dates. Segments are generated automatically.
(Optional demo data: `docker compose exec -T postgres psql -U slotcrm -d slotcrm < db/seed_demo.sql`)

Change the default credentials before real use:

```bash
ADMIN_TOKEN=some-long-secret ADMIN_USER=you ADMIN_PASSWORD=a-strong-password docker compose up --build
```

Stop with `Ctrl+C`; remove data with `docker compose down -v`.

## Option B: Without Docker

Requirements: PostgreSQL 16, Redis 7, Python 3.11+, Node 20+.

```bash
# 1. Database
createdb slotcrm   # or: psql -c "CREATE DATABASE slotcrm"
# the app defaults to postgresql://slotcrm:slotcrm@localhost:5432/slotcrm
# (create that role, or set DATABASE_URL to your own)
psql "$DATABASE_URL" -f db/001_schema.sql -f db/002_jobs.sql

# 2. Redis (default redis://localhost:6379)
redis-server

# 3. API (terminal 1)
cd api
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000

# 4. Worker (terminal 2)
cd worker
npm install
npm start

# 5. Web (terminal 3)
cd web
npm install
npm run dev        # http://localhost:3000
```

Environment variables (all have local defaults):

| Variable | Used by | Default |
|---|---|---|
| `DATABASE_URL` | api, worker | `postgresql://slotcrm:slotcrm@localhost:5432/slotcrm` |
| `REDIS_URL` | api, worker | `redis://localhost:6379` |
| `ADMIN_TOKEN` | api, web | `dev-admin-token` (must match in both) |
| `ADMIN_USER` / `ADMIN_PASSWORD` | web | `admin` / `change-me` |
| `API_URL` | web | `http://localhost:8000` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `MAIL_FROM` | worker | unset host = emails are logged, not sent; Docker defaults to Mailpit |

## Sending real email

By default every email goes to **Mailpit** (http://localhost:8025), a development inbox that
catches mail so nothing leaves your machine. To deliver to real inboxes, point the worker at a
real SMTP account. Example with Gmail:

1. Turn on 2-Step Verification for the Gmail account, then create an **App Password**
   at https://myaccount.google.com/apppasswords (a normal Gmail password will not work).
2. Copy `.env.example` to `.env` and uncomment/fill the Gmail lines:

   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=your.address@gmail.com
   SMTP_PASSWORD=your-16-character-app-password
   MAIL_FROM="Your Event Name <your.address@gmail.com>"
   ```
3. Restart the worker: `docker compose up -d --force-recreate worker`
4. Check it connected: `docker compose logs worker --tail 20` should show
   `[mail] connected to smtp.gmail.com:465 (real SMTP as ...)`. A wrong setting shows
   `[mail] CANNOT use ...` with the reason.

Keep `MAIL_FROM` the same address as `SMTP_USER`; Gmail rewrites other senders, and mail
"from" a domain you do not own (like the default `example.org`) is rejected or goes to spam.
Gmail limits sending to roughly 500 emails a day, which is plenty for this event. For a
branded sender address use a transactional provider (Brevo, Mailgun, SendGrid, Amazon SES)
with the same `SMTP_*` variables.

## Tests

With the API, worker, Postgres and Redis running:

```bash
API_URL=http://localhost:8000 ADMIN_TOKEN=dev-admin-token pytest -q api/tests
cd worker && npm test
```

## Rules enforced

- A segment can belong to only one act (database primary key).
- An act's segments must be the requested number, on one day, back-to-back
  (checked by the database at commit). PURPLE can run into PINK, but an act cannot
  jump across the 1pm-2pm break.
- Payment status (`pending` / `paid`) is informational and never blocks assignment.
- Event dates, band times and segment length are data, editable without code changes.
