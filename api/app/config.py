import os

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://slotcrm:slotcrm@localhost:5432/slotcrm")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")

ALLOCATION_QUEUE = "allocation"
NOTIFICATION_QUEUE = "notifications"

# Login sessions
SESSION_HOURS = int(os.environ.get("SESSION_HOURS", "12"))
SESSION_COOKIE = "slotcrm_session"   # must match web/lib/session.ts
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"  # true behind HTTPS
MAX_FAILED_LOGINS = 5          # consecutive wrong passwords before the account is locked
LOCKOUT_MINUTES = 15
BCRYPT_ROUNDS = 12

# First admin account: created at API startup only when no admin exists yet.
# Changing these later does nothing; use `python -m app.manage_users set-password`.
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "").strip().lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
