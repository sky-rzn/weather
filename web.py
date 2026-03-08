from fastapi import FastAPI, Query, HTTPException
import asyncpg
import os

app = FastAPI()

DB_DSN = os.getenv("DB_DSN", "postgresql://weather:1hHyh3md9JJkise340@localhost/weatherdb")

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
    """Разбирает параметры ?fields=, возвращает множество активных полей."""
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
    Универсальная функция агрегации.

    bucket_expr — SQL-выражение для группировки по времени (алиас «bucket»).
    interval    — строка интервала PostgreSQL, например '24 hours' или '30 days'.
    fields      — список значений параметра ?fields=.
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
    Данные за последние 24 часа, агрегированные по 15-минутным интервалам.

    Опциональный параметр ?fields= ограничивает набор возвращаемых полей.

    Примеры:
        /24h                              — все поля
        /24h?fields=out_t&fields=out_h    — несколько раз
        /24h?fields=out_t,out_h,p         — через запятую
    """
    bucket_expr = (
        "date_trunc('minute', ts)"
        " - (EXTRACT(MINUTE FROM ts)::int % 15) * interval '1 minute'"
    )
    return await fetch_aggregated(bucket_expr, "24 hours", fields)


@app.get("/30d")
async def last_30d(fields: list[str] = Query(default=[])):
    """
    Данные за последние 30 дней, агрегированные по суткам.

    Опциональный параметр ?fields= ограничивает набор возвращаемых полей.

    Примеры:
        /30d                              — все поля
        /30d?fields=out_t&fields=out_h    — несколько раз
        /30d?fields=out_t,out_h,p         — через запятую
    """
    bucket_expr = "date_trunc('day', ts)"
    return await fetch_aggregated(bucket_expr, "30 days", fields)
