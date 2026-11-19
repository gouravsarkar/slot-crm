"""Manage admin logins from the command line.

    python -m app.manage_users create  <email>     # prompts for a password
    python -m app.manage_users set-password <email>   # also logs that user out everywhere
    python -m app.manage_users disable <email>
    python -m app.manage_users enable  <email>
    python -m app.manage_users list

With Docker:  docker compose exec api python -m app.manage_users create you@example.org
"""
import argparse
import getpass
import sys

import psycopg

from .auth import hash_password, normalise_email
from .config import DATABASE_URL


def ask_password() -> str:
    pw = getpass.getpass("New password: ")
    if pw != getpass.getpass("Repeat password: "):
        sys.exit("Passwords do not match")
    return pw


def main() -> None:
    p = argparse.ArgumentParser(prog="python -m app.manage_users")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("create", "set-password", "disable", "enable"):
        sub.add_parser(name).add_argument("email")
    sub.add_parser("list")
    args = p.parse_args()

    with psycopg.connect(DATABASE_URL) as conn:
        if args.cmd == "list":
            rows = conn.execute("""SELECT email, is_active, last_login_at, (locked_until > now()) AS locked
                                   FROM admin_users ORDER BY email""").fetchall()
            for email, active, last, locked in rows:
                state = "active" if active else "disabled"
                print(f"{email:40} {state:9} {'LOCKED ' if locked else ''}last login: {last or 'never'}")
            if not rows:
                print("No admin users.")
            return

        try:
            email = normalise_email(args.email)
        except ValueError:
            sys.exit(f"Not a valid email: {args.email}")

        if args.cmd == "create":
            if conn.execute("SELECT 1 FROM admin_users WHERE email = %s", (email,)).fetchone():
                sys.exit(f"{email} already exists (use set-password)")
            try:
                pw_hash = hash_password(ask_password())
            except ValueError as exc:
                sys.exit(str(exc))
            conn.execute("INSERT INTO admin_users (email, password_hash) VALUES (%s, %s)", (email, pw_hash))
            print(f"Created {email}")
            return

        user = conn.execute("SELECT id FROM admin_users WHERE email = %s", (email,)).fetchone()
        if not user:
            sys.exit(f"No admin user {email}")
        if args.cmd == "set-password":
            try:
                pw_hash = hash_password(ask_password())
            except ValueError as exc:
                sys.exit(str(exc))
            conn.execute("""UPDATE admin_users SET password_hash = %s, failed_logins = 0, locked_until = NULL
                            WHERE id = %s""", (pw_hash, user[0]))
            conn.execute("DELETE FROM admin_sessions WHERE user_id = %s", (user[0],))
            print(f"Password changed for {email}; existing sessions logged out")
        else:
            active = args.cmd == "enable"
            conn.execute("UPDATE admin_users SET is_active = %s, failed_logins = 0, locked_until = NULL WHERE id = %s",
                         (active, user[0]))
            if not active:
                conn.execute("DELETE FROM admin_sessions WHERE user_id = %s", (user[0],))
            print(f"{email} {'enabled' if active else 'disabled'}")


if __name__ == "__main__":
    main()
