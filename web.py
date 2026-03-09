from fastapi import FastAPI, Query, HTTPException
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
    "p", "ws", "wd", "uv", "rad", "pr",
}

SUM_FIELDS = {"pr"}
VECTOR_FIELDS = {"wd"}

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

async def fetch_aggregated(bucket_expr: str, interval: str, fields: list[str]) -> list[dict]:
    """
    Universal aggregation function.

    bucket_expr — SQL expression for time grupping
    interval    — PostgreSQL interval, for example '24 hours' or '30 days'
    fields      — ?fields= values set
    """
    active = parse_fields(fields)

    select_parts = [f"{bucket_expr} AS bucket"]
    for field in sorted(active):
        if field in SUM_FIELDS:
            select_parts.append(f"sum({field})  AS {field}_sum")
        elif field in VECTOR_FIELDS:
            select_parts.append(
                f"(degrees(atan2(avg(sin(radians({field}))), avg(cos(radians({field}))))) + 360)::numeric % 360 AS {field}_avg"
            )
        else:
            select_parts.append(f"min({field})  AS {field}_min")
            select_parts.append(f"max({field})  AS {field}_max")
            select_parts.append(f"avg({field})  AS {field}_avg")

    sql = f"""
        SELECT
            {', '.join(select_parts)}
        FROM raw_data
        WHERE ts >= now() - interval '{interval}'
        GROUP BY 1
        ORDER BY 1
    """

    conn = await get_conn()
    try:
        rows = await conn.fetch(sql)
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
async def last_24h(fields: list[str] = Query(default=[])):
    """
    Data for the last 24 hours, aggregated by 15-minutes periods.

    Optional argument ?fields= limits returning fields set.

    Examples:
        /24h                              - all the fields
        /24h?fields=out_t&fields=out_h    - repeated argument
        /24h?fields=out_t,out_h,p         - separated by comma
    """
    bucket_expr = (
        "date_trunc('minute', ts)"
        " - (EXTRACT(MINUTE FROM ts)::int % 15) * interval '1 minute'"
    )
    return await fetch_aggregated(bucket_expr, "24 hours", fields)


@app.get("/30d")
async def last_30d(fields: list[str] = Query(default=[])):
    """
    Data for the last 30 days, aggregated by days.

    Optional argument ?fields= limits returning fields set.

    Examples:
        /30d                              - all the fields
        /30d?fields=out_t&fields=out_h    - repeated argument
        /30d?fields=out_t,out_h,p         - separated by comma
    """
    bucket_expr = "date_trunc('day', ts)"
    return await fetch_aggregated(bucket_expr, "30 days", fields)
