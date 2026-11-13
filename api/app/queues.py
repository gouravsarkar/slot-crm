"""Producer side of the Redis queues. The Node worker consumes these (BullMQ)."""
import logging

from bullmq import Queue

from .config import ALLOCATION_QUEUE, NOTIFICATION_QUEUE, REDIS_URL

log = logging.getLogger("queues")

_queues: dict[str, Queue] = {}


def _queue(name: str) -> Queue:
    if name not in _queues:
        _queues[name] = Queue(name, {"connection": REDIS_URL})
    return _queues[name]


async def enqueue_allocation(kind: str, job_id: str, data: dict) -> None:
    await _queue(ALLOCATION_QUEUE).add(
        kind, data, {"jobId": job_id, "removeOnComplete": 1000, "removeOnFail": 1000}
    )


async def enqueue_notification(kind: str, data: dict) -> None:
    """Best effort: a Redis outage must not lose a saved request."""
    try:
        await _queue(NOTIFICATION_QUEUE).add(
            kind, data, {"attempts": 5, "backoff": {"type": "exponential", "delay": 5000},
                         "removeOnComplete": 1000, "removeOnFail": 1000}
        )
    except Exception:  # noqa: BLE001
        log.exception("could not enqueue notification %s %s", kind, data)


async def close_queues() -> None:
    for q in _queues.values():
        await q.close()
    _queues.clear()
