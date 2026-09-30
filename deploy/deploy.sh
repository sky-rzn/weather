#!/bin/bash
# Пересборка и перезапуск контейнеров из текущего чекаута.
# Вызывается из /usr/local/bin/weather-deploy после обновления чекаута.
set -euo pipefail
cd "$(dirname "$0")/.."

export WEATHER_UID=$(id -u weather) WEATHER_GID=$(id -g weather)

# compose пересоздаёт только те контейнеры, чей образ изменился
docker compose up -d --build --quiet-build --remove-orphans

# Проверка: пояс в контейнере, API отвечает, коллектор слушает порт
tz=$(docker compose exec -T api date +%Z)
case "$tz" in CET|CEST) ;; *) echo "FAIL: TZ в контейнере $tz, ожидался CET/CEST" >&2; exit 1 ;; esac

for i in $(seq 1 15); do
    curl -fs -o /dev/null http://127.0.0.1:8001/current && api_ok=1 && break
    sleep 1
done
[ "${api_ok:-}" = 1 ] || { echo "FAIL: API не отвечает" >&2; docker compose logs --tail 30 api >&2; exit 1; }

ss -ltn | grep -q ':7777 ' || { echo "FAIL: коллектор не слушает 7777" >&2; docker compose logs --tail 30 collector >&2; exit 1; }

docker image prune -f >/dev/null
echo "OK: $(git log --oneline -1)"
