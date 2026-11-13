import os

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://slotcrm:slotcrm@localhost:5432/slotcrm")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "dev-admin-token")

ALLOCATION_QUEUE = "allocation"
NOTIFICATION_QUEUE = "notifications"
