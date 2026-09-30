# Один Dockerfile, две цели: collector (server.py) и api (web.py).
# Каждый образ копирует только свои файлы, поэтому правка web.py
# не пересобирает и не перезапускает коллектор, и наоборот.

FROM python:3.14-slim AS base
# raw_data.ts хранится как наивное местное время Europe/Berlin,
# поэтому пояс процесса обязан быть именно таким.
ENV TZ=Europe/Berlin \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

FROM base AS collector
COPY requirements-collector.txt .
RUN pip install --no-cache-dir -r requirements-collector.txt
COPY server.py .
CMD ["python", "server.py"]

FROM base AS api
COPY requirements-api.txt .
RUN pip install --no-cache-dir -r requirements-api.txt
COPY web.py .
CMD ["uvicorn", "web:app", "--host", "127.0.0.1", "--port", "8001"]
