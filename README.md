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
| `/portal` | Participants (public, no login) | Participant portal: **Book a slot for your program** or **Check your program's slot** |
| `/portal/book` | Participants | Same request form, phone number mandatory; saved to the same tables, so it appears on the Admin page |
| `/portal/check` | Participants | Enter email + phone number to see every booking made with them: status, payment and confirmed times |
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
- Admin: http://localhost:3000/admin (log in with `admin@example.org` / `change-me-now`)
- Event settings (create event, set dates): http://localhost:3000/admin/settings
- API docs: http://localhost:8000/docs
- Caught emails (dev): http://localhost:8025

First-time setup: go to **Admin > Event settings**, create an event, then add its
Saturday and Sunday dates. Segments are generated automatically.
(Optional demo data: `docker compose exec -T postgres psql -U slotcrm -d slotcrm < db/seed_demo.sql`)

Change the default login before real use (see [Admin logins](#admin-logins)):

```bash
docker compose exec api python -m app.manage_users set-password admin@example.org
```

Stop with `Ctrl+C`; remove data with `docker compose down -v`.

## Option B: Without Docker

Requirements: PostgreSQL 16, Redis 7, Python 3.11+, Node 20+.

```bash
# 1. Database
createdb slotcrm   # or: psql -c "CREATE DATABASE slotcrm"
# the app defaults to postgresql://slotcrm:slotcrm@localhost:5432/slotcrm
# (create that role, or set DATABASE_URL to your own)
psql "$DATABASE_URL" -f db/001_schema.sql -f db/002_jobs.sql -f db/003_auth.sql

# 2. Redis (default redis://localhost:6379)
redis-server

# 3. API (terminal 1)
cd api
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
ADMIN_EMAIL=you@example.org ADMIN_PASSWORD=a-strong-password uvicorn app.main:app --port 8000

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
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | api | first admin, created only while none exists (Docker: `admin@example.org` / `change-me-now`) |
| `SESSION_HOURS` | api | `12` (how long a login lasts) |
| `COOKIE_SECURE` | api | `false` (set `true` behind HTTPS) |
| `API_URL` | web | `http://localhost:8000` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `MAIL_FROM` | worker | unset host = emails are logged, not sent; Docker defaults to Mailpit |

## Admin logins

Admins log in at `/login` with their **email and password**. Everything is stored in the
existing Postgres database (`db/003_auth.sql`):

- `admin_users`: email (lower-case, unique) and a **bcrypt** hash of the password (cost 12).
- `admin_sessions`: one row per logged-in browser, holding only a SHA-256 of the session
  token. Sessions expire after `SESSION_HOURS`.
- **Cookies:** on login FastAPI sets an httpOnly, SameSite=Lax cookie `slotcrm_session`
  (Secure when `COOKIE_SECURE=true`). The token is never in a response body or readable by
  page JavaScript. FastAPI reads the cookie on every admin call; Next.js only passes it
  through. Logging out deletes the session row and expires the cookie.
- After 5 wrong passwords in a row an account is locked for 15 minutes.
- Jobs and assignments record the email of the admin who made them.

The first account comes from `ADMIN_EMAIL` / `ADMIN_PASSWORD` when the API starts and no
admin exists yet. Manage accounts from the command line:

```bash
docker compose exec api python -m app.manage_users create   someone@example.org
docker compose exec api python -m app.manage_users set-password someone@example.org  # logs them out everywhere
docker compose exec api python -m app.manage_users disable  someone@example.org
docker compose exec api python -m app.manage_users list
```

**Upgrading an existing database** (Postgres only runs the `db/` files on a brand-new volume):

```bash
docker compose exec -T postgres psql -U slotcrm -d slotcrm < db/003_auth.sql
docker compose up -d --build api web
```

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
API_URL=http://localhost:8000 ADMIN_EMAIL=admin@example.org ADMIN_PASSWORD=change-me-now pytest -q api/tests
cd worker && npm test
```

## Rules enforced

- A segment can belong to only one act (database primary key).
- An act's segments must be the requested number, on one day, back-to-back
  (checked by the database at commit). PURPLE can run into PINK, but an act cannot
  jump across the 1pm-2pm break.
- Payment status (`pending` / `paid`) is informational and never blocks assignment.
- Event dates, band times and segment length are data, editable without code changes.
