from fastapi import FastAPI, Query, HTTPException
from datetime import date, datetime, timedelta
import asyncpg
import os

app = FastAPI()

DB_HOST = os.getenv("DB_HOST")
DB_NAME = os.getenv("DB_NAME")
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")

DB_DSN = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}/{DB_NAME}"

ALLOWED_FIELDS = {
    "out_t", "out_h", "out_d",
    "in_t",  "in_h",
    "in_t2", "in_h2",
    "p", "ws", "wd", "uv", "rad", "pr", "prd",
}

VECTOR_FIELDS = {"wd"}

MAX_FIELDS = {"prd"}

async def get_conn():
    return await asyncpg.connect(DB_DSN)

def parse_fields(fields: list[str]) -> set[str]:
    """Parse ?fields=, return active fields set."""
    requested: set[str] = set()
    for f in fields:
        for part in f.split(","):
            part = part.strip()
            if part:
                requested.add(part)

    if not requested:
        return set(ALLOWED_FIELDS)

    unknown = requested - ALLOWED_FIELDS
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unknown fields: {sorted(unknown)}. "
                f"Allowed: {sorted(ALLOWED_FIELDS)}"
            ),
        )
    return requested

def parse_month(month: str) -> date:
    """Parse ?month=YYYY-MM, return the first day of the month."""
    try:
        return datetime.strptime(month, "%Y-%m").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")

def next_month(d: date) -> date:
    return date(d.year + d.month // 12, d.month % 12 + 1, 1)

async def fetch_aggregated(
    bucket_expr: str,
    interval: str,
    fields: list[str],
    start: date | None = None,
    end: date | None = None,
) -> list[dict]:
    """
    Universal aggregation function.

    bucket_expr — SQL expression for time grupping
    interval    — PostgreSQL interval, for example '24 hours' or '30 days';
                  used when start/end are not given
    fields      — ?fields= values set
    start, end  — optional period [start, end) in local station time
    """
    active = parse_fields(fields)

    select_parts = [f"{bucket_expr} AS bucket"]
    for field in sorted(active):
        if field in VECTOR_FIELDS:
            select_parts.append(
                f"(degrees(atan2(avg(sin(radians({field}))), avg(cos(radians({field}))))) + 360)::numeric % 360 AS {field}_avg"
            )
        elif field in MAX_FIELDS:
            select_parts.append(f"max({field})  AS {field}_max")
        else:
            select_parts.append(f"min({field})  AS {field}_min")
            select_parts.append(f"max({field})  AS {field}_max")
            select_parts.append(f"avg({field})  AS {field}_avg")

    if start is not None and end is not None:
        where = "ts >= $1 AND ts < $2"
        args = [datetime.combine(start, datetime.min.time()),
                datetime.combine(end, datetime.min.time())]
    else:
        where = f"ts >= now() - interval '{interval}'"
        args = []

    sql = f"""
        SELECT
            {', '.join(select_parts)}
        FROM raw_data
        WHERE {where}
        GROUP BY 1
        ORDER BY 1
    """

    conn = await get_conn()
    try:
        rows = await conn.fetch(sql, *args)
        return [dict(r) for r in rows]
    finally:
        await conn.close()


@app.get("/current")
async def current():
    conn = await get_conn()
    try:
        row = await conn.fetchrow("""
            SELECT * FROM raw_data
            ORDER BY ts DESC
            LIMIT 1
        """)
        return dict(row)
    finally:
        await conn.close()


@app.get("/24h")
async def last_24h(
    fields: list[str] = Query(default=[]),
    day: date | None = Query(default=None, alias="date"),
):
    """
    Data for the last 24 hours, aggregated by 15-minutes periods.

    Optional argument ?fields= limits returning fields set.
    Optional argument ?date=YYYY-MM-DD returns that calendar day instead.

    Examples:
        /24h                              - all the fields
        /24h?fields=out_t&fields=out_h    - repeated argument
        /24h?fields=out_t,out_h,p         - separated by comma
        /24h?date=2026-09-15&fields=p     - a specific day
    """
    bucket_expr = (
        "date_trunc('minute', ts)"
        " - (EXTRACT(MINUTE FROM ts)::int % 15) * interval '1 minute'"
    )
    if day is not None:
        return await fetch_aggregated(bucket_expr, "24 hours", fields,
                                      day, day + timedelta(days=1))
    return await fetch_aggregated(bucket_expr, "24 hours", fields)


@app.get("/30d")
async def last_30d(
    fields: list[str] = Query(default=[]),
    month: str | None = Query(default=None),
):
    """
    Data for the last 30 days, aggregated by days.

    Optional argument ?fields= limits returning fields set.
    Optional argument ?month=YYYY-MM returns that calendar month instead.

    Examples:
        /30d                              - all the fields
        /30d?fields=out_t&fields=out_h    - repeated argument
        /30d?fields=out_t,out_h,p         - separated by comma
        /30d?month=2026-08&fields=p       - a specific month
    """
    bucket_expr = "date_trunc('day', ts)"
    if month is not None:
        start = parse_month(month)
        return await fetch_aggregated(bucket_expr, "30 days", fields,
                                      start, next_month(start))
    return await fetch_aggregated(bucket_expr, "30 days", fields)
