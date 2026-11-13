from collections.abc import AsyncIterator

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from .config import DATABASE_URL

pool: AsyncConnectionPool | None = None


async def open_pool() -> None:
    global pool
    pool = AsyncConnectionPool(
        DATABASE_URL, min_size=1, max_size=10, open=False,
        kwargs={"row_factory": dict_row},
    )
    await pool.open(wait=True)


async def close_pool() -> None:
    if pool is not None:
        await pool.close()


async def get_conn() -> AsyncIterator:
    """One connection per request; commits on success, rolls back on error."""
    assert pool is not None, "pool not open"
    async with pool.connection() as conn:
        yield conn
