#!/usr/bin/env python3

import socket
import threading
import os
import time
from urllib.parse import urlparse, parse_qs
from datetime import datetime
import logging
from logging.handlers import RotatingFileHandler


import psycopg2
from psycopg2 import pool

HOST = '0.0.0.0'
PORT = 7777
LOG_FILE = '/var/lib/weather/log/server.log'

# --- Narodmon ---
NARODMON_HOST = 'narodmon.ru'
NARODMON_PORT = 8283
# MAC устройства, под которым станция зарегистрирована на narodmon.ru
NARODMON_MAC = os.getenv('NARODMON_MAC')
# Минимальный разрешённый интервал между отправками — 5 минут.
# Берём с запасом, чтобы не словить бан по флуду.
NARODMON_MIN_INTERVAL = int(os.getenv('NARODMON_MIN_INTERVAL', '300'))
NARODMON_TIMEOUT = 10.0

logger = logging.getLogger('server_logger')
logger.setLevel(logging.INFO)
handler = RotatingFileHandler(LOG_FILE, maxBytes=5*1024*1024, backupCount=100)
formatter = logging.Formatter('%(asctime)s [%(levelname)s] %(message)s')
handler.setFormatter(formatter)
logger.addHandler(handler)

DB_HOST = os.getenv('DB_HOST')
DB_NAME = os.getenv('DB_NAME')
DB_USER = os.getenv('DB_USER')
DB_PASSWORD = os.getenv('DB_PASSWORD')

STATION_ID = os.getenv('STATION_ID')
STATION_PASSWORD = os.getenv('STATION_PASSWORD')

DB_DSN = os.getenv('DB_DSN', f'host={DB_HOST} dbname={DB_NAME} user={DB_USER} password={DB_PASSWORD}')

db_pool = pool.ThreadedConnectionPool(minconn=1, maxconn=10, dsn=DB_DSN)

def f_to_c(val: str | None) -> float | None:
    if val is None:
        return None
    try:
        return round((float(val) - 32) * 5 / 9, 4)
    except (ValueError, TypeError):
        return None


def to_float(val: str | None) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def inhg_to_mmhg(val: str | None) -> float | None:
    if val is None:
        return None
    try:
        return round(float(val) * 25.4, 4)
    except (ValueError, TypeError):
        return None


def in_to_mm(val: str | None) -> float | None:
    if val is None:
        return None
    try:
        return round(float(val) * 25.4, 4)
    except (ValueError, TypeError):
        return None

def mph_to_ms(val: str | None) -> float | None:
    if val is None:
        return None
    try:
        return round(float(val) * 0.44704, 4)
    except (ValueError, TypeError):
        return None

def save_record(params: dict, ts: datetime) -> dict:
    row = {
        'ts':    ts,
        'out_t': f_to_c(params.get('tempf')),
        'out_h': to_float(params.get('humidity')),
        'out_d': f_to_c(params.get('dewptf')),
        'in_t':  f_to_c(params.get('indoortempf')),
        'in_h':  to_float(params.get('indoorhumidity')),
        'in_t2': f_to_c(params.get('soiltempf')),
        'in_h2': to_float(params.get('soilmoisture')),
        'p':     inhg_to_mmhg(params.get('baromin')),
        'uv':    to_float(params.get('UV')),
        'rad':   to_float(params.get('solarradiation')),
        'wd':    to_float(params.get('winddir')),
        'ws':    mph_to_ms(params.get('windspeedmph')),
        'wgs':   mph_to_ms(params.get('windgustmph')),
        'pr':    in_to_mm(params.get('rainin')),
        'prd':   in_to_mm(params.get('dailyrainin')),
    }

    sql = '''
        INSERT INTO raw_data
            (ts, out_t, out_h, out_d, in_t, in_h, in_t2, in_h2,
             p, uv, rad, wd, ws, wgs, pr, prd)
        VALUES
            (%(ts)s, %(out_t)s, %(out_h)s, %(out_d)s, %(in_t)s, %(in_h)s,
             %(in_t2)s, %(in_h2)s, %(p)s, %(uv)s, %(rad)s, %(wd)s,
             %(ws)s, %(wgs)s, %(pr)s, %(prd)s)
        ON CONFLICT (ts) DO UPDATE SET
            out_t  = EXCLUDED.out_t,
            out_h  = EXCLUDED.out_h,
            out_d  = EXCLUDED.out_d,
            in_t   = EXCLUDED.in_t,
            in_h   = EXCLUDED.in_h,
            in_t2  = EXCLUDED.in_t2,
            in_h2  = EXCLUDED.in_h2,
            p      = EXCLUDED.p,
            uv     = EXCLUDED.uv,
            rad    = EXCLUDED.rad,
            wd     = EXCLUDED.wd,
            ws     = EXCLUDED.ws,
            wgs    = EXCLUDED.wgs,
            pr     = EXCLUDED.pr,
            prd    = EXCLUDED.prd;
    '''

    conn = db_pool.getconn()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(sql, row)
    finally:
        db_pool.putconn(conn)

    return row


# --- Narodmon: throttling и отправка ---
_narodmon_lock = threading.Lock()
_narodmon_last_sent = 0.0  # monotonic timestamp последней отправки


def _format_value(v):
    """Narodmon ожидает числовые значения как простые float-литералы."""
    if v is None:
        return None
    if isinstance(v, float):
        # без научной записи и лишних нулей
        return f'{v:.4f}'.rstrip('0').rstrip('.')
    return str(v)


def build_narodmon_packet(mac: str, row: dict) -> str | None:
    """
    Собирает TCP-пакет для narodmon.ru из row, подготовленного save_record.
    Отправляем только уличные датчики; внутренние (in_*) пропускаем.

    Формат:
        #MAC\n
        #sensorId#value\n
        ...
        ##
    Имена датчиков начинаются с буквы, понятной narodmon (T — температура,
    H — влажность, P — давление, W — ветер и т. п.) — сервис сам определит тип.
    """
    # Маппинг ключ из row -> имя датчика на narodmon.
    # Префикс mac обеспечивает уникальность ID в рамках устройства.
    outdoor_sensors = [
        ('out_t', 'T1'),    # температура воздуха, °C
        ('out_h', 'H1'),    # влажность воздуха, %
        ('out_d', 'T2'),    # точка росы, °C
        ('p',     'P1'),    # давление, мм рт. ст.
        ('uv',    'UV1'),   # УФ-индекс
        ('rad',   'RAD1'),  # солнечная радиация, Вт/м²
        ('wd',    'WD1'),   # направление ветра, °
        ('ws',    'WS1'),   # скорость ветра, м/с
        ('wgs',   'WG1'),   # порыв ветра, м/с
        ('pr',    'PR1'),   # осадки за период, мм
        ('prd',   'PRD1'),  # осадки за сутки, мм
    ]

    lines = [f'#{mac}']
    for key, sensor_name in outdoor_sensors:
        val = _format_value(row.get(key))
        if val is None:
            continue
        # ID датчика = MAC + имя, чтобы был уникален у устройства
        lines.append(f'#{mac}{sensor_name}#{val}')

    if len(lines) == 1:
        # нет ни одного значения — отправлять нечего
        return None

    return '\n'.join(lines) + '\n##'


def send_to_narodmon(row: dict) -> None:
    """
    Отправляет уличные показания на narodmon.ru.
    Учитывает минимальный интервал между отправками. В случае ошибки —
    логирует и молча выходит, чтобы не ломать основной поток сохранения.
    """
    if not NARODMON_MAC:
        return

    global _narodmon_last_sent
    now_mono = time.monotonic()

    with _narodmon_lock:
        if now_mono - _narodmon_last_sent < NARODMON_MIN_INTERVAL:
            # слишком рано — пропускаем
            return
        # резервируем слот заранее, чтобы параллельные потоки
        # не пытались отправить одновременно
        _narodmon_last_sent = now_mono

    packet = build_narodmon_packet(NARODMON_MAC, row)
    if packet is None:
        logger.info('narodmon: нет данных для отправки')
        return

    try:
        with socket.create_connection(
            (NARODMON_HOST, NARODMON_PORT), timeout=NARODMON_TIMEOUT
        ) as s:
            s.sendall(packet.encode('utf-8'))
            try:
                resp = s.recv(1024).decode('utf-8', errors='replace').strip()
            except socket.timeout:
                resp = '<no response>'
        print(f'  narodmon: sent, response: {resp!r}')
        logger.info('narodmon: sent OK, response: %s', resp)
    except (socket.error, OSError) as e:
        # Откатываем штамп, чтобы можно было попытаться отправить
        # на следующем приходе данных, а не ждать полный интервал.
        with _narodmon_lock:
            _narodmon_last_sent = 0.0
        print(f'  narodmon: send error: {e}')
        logger.warning('narodmon: send error: %s', e)


def handle_client(conn, addr):
    now = datetime.now()
    print(f'\n{'='*60}')
    print(f'[{now.strftime('%Y-%m-%d %H:%M:%S')}] Connection from {addr[0]}:{addr[1]}')

    raw = ''

    try:
        data = b''
        conn.settimeout(3.0)
        while True:
            try:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                data += chunk
            except socket.timeout:
                break

        raw += data.decode('utf-8', errors='replace')

        request_line = raw.split('\r\n')[0] if '\r\n' in raw else raw.split('\n')[0]
        print(f'Request: {request_line}')

        parts = request_line.split(' ')
        if len(parts) < 2:
            raise ValueError('Incorrect request')

        if parts[0] != 'GET':
            raise ValueError('Incorrect request type')

        path = parts[1]
        parsed = urlparse(path)
        if parsed.path != '/weatherstation/updateweatherstation.php':
            raise ValueError('Incorrect path "%s"' % parsed.path)

        params = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        if params['ID'] != STATION_ID or params['PASSWORD'] != STATION_PASSWORD:
            raise ValueError('Unknown station')


        row = save_record(params, now)

        # Отправляем уличные показания в Народный мониторинг.
        # В отдельном потоке, чтобы не задерживать ответ метеостанции
        # и не уронить основной обработчик при сетевых ошибках narodmon.
        threading.Thread(
            target=send_to_narodmon, args=(row,), daemon=True
        ).start()

        response_body = 'success\n'
        response = (
            'HTTP/1.1 200 OK\r\n'
            'Content-Type: text/plain; charset=utf-8\r\n'
            f'Content-Length: {len(response_body)}\r\n'
            'Connection: close\r\n'
            '\r\n'
            + response_body
        )
        conn.sendall(response.encode('utf-8'))
        print('  Sent response: 200 OK')

    except Exception as e:
        print(f'  Response handling error: {e}')
        try:
            body = 'HAHAHA! FUCK OFF!'
            response = (
                'HTTP/1.1 400 Bad Request\r\n'
                'Content-Type: text/plain; charset=utf-8\r\n'
                f'Content-Length: {len(body.encode())}\r\n'
                'Connection: close\r\n'
                '\r\n'
                f'{body}'
            )
            conn.sendall(response.encode())
        except Exception:
            pass
        logger.info(f'========= [{addr[0]}:{addr[1]}] {e}')
        logger.info(raw[:1000])
    finally:
        conn.close()


def main():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((HOST, PORT))
    server.listen(10)

    print('Weather station server runs')
    print(f'Waiting connections on port {PORT}... (Ctrl+C for stop)\n')
    logger.info('******** server started ********')

    try:
        while True:
            conn, addr = server.accept()
            t = threading.Thread(target=handle_client, args=(conn, addr), daemon=True)
            t.start()
    except KeyboardInterrupt:
        print('\nServer stopped.')
    finally:
        server.close()
        db_pool.closeall()


if __name__ == '__main__':
    main()
