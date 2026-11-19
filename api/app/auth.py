"""Admin login: email + bcrypt password; session token in an httpOnly cookie, sessions stored in Postgres."""
import hashlib
import logging
import secrets

import bcrypt
import psycopg.errors as pgerr
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr, TypeAdapter
from starlette.concurrency import run_in_threadpool

from . import db
from .config import (ADMIN_EMAIL, ADMIN_PASSWORD, BCRYPT_ROUNDS, COOKIE_SECURE, LOCKOUT_MINUTES,
                     MAX_FAILED_LOGINS, SESSION_COOKIE, SESSION_HOURS)

log = logging.getLogger("auth")

MIN_PASSWORD_LEN = 8
MAX_PASSWORD_BYTES = 72  # bcrypt only uses the first 72 bytes; refuse longer instead of truncating

_email = TypeAdapter(EmailStr)


# ------------------------------------------------------------- passwords

def normalise_email(email: str) -> str:
    """Validated, trimmed, lower-case email (raises ValueError if invalid)."""
    return _email.validate_python(email.strip()).lower()


def check_password_rules(password: str) -> None:
    if len(password) < MIN_PASSWORD_LEN:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LEN} characters")
    if len(password.encode()) > MAX_PASSWORD_BYTES:
        raise ValueError(f"Password must be at most {MAX_PASSWORD_BYTES} bytes")


def hash_password(password: str) -> str:
    check_password_rules(password)
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode()


def verify_password(password: str, password_hash: str) -> bool:
    pw = password.encode()
    if len(pw) > MAX_PASSWORD_BYTES:
        return False
    try:
        return bcrypt.checkpw(pw, password_hash.encode())
    except ValueError:  # malformed hash in the database
        return False


# Compared against when the email is unknown, so a login takes the same time
# whether or not the account exists.
_DUMMY_HASH = bcrypt.hashpw(b"not-a-real-password", bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# --------------------------------------------------------------- sessions

# Same attributes on set and delete, or the browser treats them as different cookies.
_COOKIE_ATTRS = {"path": "/", "httponly": True, "samesite": "lax", "secure": COOKIE_SECURE}


def _session_cookie(token: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> str | None:
    return token or None


async def current_admin(token: str | None = Depends(_session_cookie), conn=Depends(db.get_conn)) -> dict:
    """Dependency for admin routes: requires a valid session cookie."""
    if not token:
        raise HTTPException(401, "Login required")
    cur = await conn.execute("""
        SELECT u.id, u.email FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
        WHERE s.token_hash = %s AND s.expires_at > now() AND u.is_active""", (_token_hash(token),))
    user = await cur.fetchone()
    if not user:
        raise HTTPException(401, "Session expired or invalid")
    return user


class LoginIn(BaseModel):
    email: str
    password: str


router = APIRouter(prefix="/api/auth")


@router.post("/login")
async def login(body: LoginIn, response: Response, conn=Depends(db.get_conn)):
    email = body.email.strip().lower()
    cur = await conn.execute("""
        SELECT id, email, password_hash, is_active, (locked_until > now()) AS locked
        FROM admin_users WHERE email = %s""", (email,))
    user = await cur.fetchone()

    if user and user["locked"]:
        raise HTTPException(429, f"Too many failed attempts. Try again in {LOCKOUT_MINUTES} minutes.")

    # bcrypt is deliberately slow; keep it off the event loop
    ok = await run_in_threadpool(verify_password, body.password,
                                 user["password_hash"] if user else _DUMMY_HASH)

    if not user or not ok or not user["is_active"]:
        if user:
            await conn.execute("""
                UPDATE admin_users
                   SET failed_logins = failed_logins + 1,
                       locked_until = CASE WHEN failed_logins + 1 >= %s
                                           THEN now() + make_interval(mins => %s) END
                 WHERE id = %s""", (MAX_FAILED_LOGINS, LOCKOUT_MINUTES, user["id"]))
            await conn.commit()
        raise HTTPException(401, "Invalid email or password")

    token = secrets.token_urlsafe(32)
    await conn.execute("DELETE FROM admin_sessions WHERE expires_at <= now()")
    cur = await conn.execute("""
        INSERT INTO admin_sessions (token_hash, user_id, expires_at)
        VALUES (%s, %s, now() + make_interval(hours => %s)) RETURNING expires_at""",
                             (_token_hash(token), user["id"], SESSION_HOURS))
    session = await cur.fetchone()
    await conn.execute("""
        UPDATE admin_users SET failed_logins = 0, locked_until = NULL, last_login_at = now()
         WHERE id = %s""", (user["id"],))
    await conn.commit()
    # the token only travels in the cookie, never in the response body
    response.set_cookie(SESSION_COOKIE, token, max_age=SESSION_HOURS * 3600, **_COOKIE_ATTRS)
    return {"expires_at": session["expires_at"], "user": {"id": user["id"], "email": user["email"]}}


@router.post("/logout", status_code=204)
async def logout(response: Response, token: str | None = Depends(_session_cookie), conn=Depends(db.get_conn)):
    if token:
        await conn.execute("DELETE FROM admin_sessions WHERE token_hash = %s", (_token_hash(token),))
        await conn.commit()
    response.delete_cookie(SESSION_COOKIE, **_COOKIE_ATTRS)


@router.get("/me")
async def me(user=Depends(current_admin)):
    return user


# --------------------------------------------------------------- bootstrap

async def ensure_first_admin() -> None:
    """Create the ADMIN_EMAIL account at startup if there are no admins at all."""
    async with db.pool.connection() as conn:
        try:
            cur = await conn.execute("SELECT EXISTS (SELECT 1 FROM admin_users) AS any")
        except pgerr.UndefinedTable:
            log.error("admin_users table missing: run db/003_auth.sql against the database")
            return
        if (await cur.fetchone())["any"]:
            return
        if not ADMIN_EMAIL or not ADMIN_PASSWORD:
            log.warning("No admin account exists. Set ADMIN_EMAIL and ADMIN_PASSWORD, "
                        "or run: python -m app.manage_users create <email>")
            return
        try:
            email = normalise_email(ADMIN_EMAIL)
            pw_hash = await run_in_threadpool(hash_password, ADMIN_PASSWORD)
        except ValueError as exc:
            log.error("Cannot create first admin from ADMIN_EMAIL/ADMIN_PASSWORD: %s", exc)
            return
        await conn.execute(
            "INSERT INTO admin_users (email, password_hash) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (email, pw_hash))
        await conn.commit()
        log.warning("Created first admin %s. Change its password before real use.", email)
