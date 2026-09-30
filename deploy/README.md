# Деплой на vps2

`git push` в `main` → GitHub Actions (`.github/workflows/deploy.yml`) заходит
на vps2 по SSH-ключу, привязанному к forced command `/usr/local/bin/weather-deploy`.
Тот обновляет чекаут `/srv/weather` до `origin/main` и запускает `deploy/deploy.sh`:
`docker compose up -d --build` и проверки (пояс CET/CEST в контейнере, API
отвечает, порт 7777 слушается). Упавшая проверка валит workflow.

## Что где

| Что | Где |
|---|---|
| Код, статика | `/srv/weather` (git-чекаут, статику nginx берёт из `web/`) |
| Контейнеры | `weather-collector-1` (порт 7777), `weather-api-1` (127.0.0.1:8001), `network_mode: host` |
| Секреты | `/etc/weather/env` (в репозиторий не попадает) |
| Лог коллектора | `/var/lib/weather/log/server.log` |
| nginx | `/etc/nginx/sites-available/weather`, копия в `deploy/nginx/weather.conf` — применяется руками |
| Ключ деплоя | `/root/.ssh/authorized_keys`, строка с `weather-deploy@github-actions` |
| Секреты GitHub | `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_HOST` |

PostgreSQL остаётся на хосте. Контейнеры ходят в него через `DB_HOST=localhost`.

## Часовой пояс

`raw_data.ts` — наивное время Europe/Berlin. `TZ=Europe/Berlin` задан и в образе,
и в `compose.yaml`; `deploy.sh` проверяет его после каждого деплоя. База тоже
настроена на этот пояс (`ALTER DATABASE weatherdb SET timezone TO 'Europe/Berlin'`).

## Руками

```sh
cd /srv/weather
deploy/deploy.sh                         # передеплоить текущий чекаут
docker compose logs -f --tail 50 api     # логи
gh workflow run Deploy                   # локально: деплой без коммита
```

## Откат на systemd

Старые юниты `weather.service` и `weather-api.service` отключены, но не удалены,
файлы в `/var/lib/weather` не тронуты:

```sh
cd /srv/weather && docker compose down
systemctl enable --now weather.service weather-api.service
# и вернуть root /var/lib/weather/web; в /etc/nginx/sites-available/weather
```
