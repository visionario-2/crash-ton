# backend/main.py — FastAPI + WebSocket + SSE + Frontend estático
import os
import asyncio
import json
import math
import time
from typing import Set

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from starlette.responses import StreamingResponse

# ------------------------------------------------------------------------------
# App e CORS
# ------------------------------------------------------------------------------
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------------------------------------------------------
# Paths do frontend (ajustados para sua árvore de pastas)
#  backend/
#  frontend/
#    ├─ index.html
#    ├─ _config.js
#    ├─ public/...
#    └─ src/...
# ------------------------------------------------------------------------------
HERE = os.path.dirname(__file__)
FRONT_DIR = os.path.normpath(os.path.join(HERE, "..", "frontend"))
PUBLIC_DIR = os.path.join(FRONT_DIR, "public")
SRC_DIR = os.path.join(FRONT_DIR, "src")

# Servir arquivos estáticos do frontend
app.mount("/public", StaticFiles(directory=PUBLIC_DIR), name="public")
app.mount("/src", StaticFiles(directory=SRC_DIR), name="src")

# _config.js (carregado pelo index.html)
@app.get("/_config.js")
def _config_js():
    return FileResponse(os.path.join(FRONT_DIR, "_config.js"))

# Rota raiz -> index.html
@app.get("/", response_class=HTMLResponse)
def index():
    return FileResponse(os.path.join(FRONT_DIR, "index.html"))

# ------------------------------------------------------------------------------
# Utilidades do jogo
# ------------------------------------------------------------------------------
clients: Set[WebSocket] = set()

def now_ms() -> int:
    return int(time.time() * 1000)

async def broadcast(obj: dict):
    """Envia um JSON para todos os clientes WS conectados."""
    msg = json.dumps(obj)
    dead = []
    for ws in list(clients):
        try:
            await ws.send_text(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)

# ------------------------------------------------------------------------------
# Healthcheck
# ------------------------------------------------------------------------------
@app.get("/health")
def health():
    return {"ok": True, "now": now_ms()}

# ------------------------------------------------------------------------------
# WebSocket de stream
# ------------------------------------------------------------------------------
@app.websocket("/stream")
async def stream(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    try:
        # Mantém a conexão viva aguardando mensagens do cliente.
        # O frontend não envia nada; se desconectar, levantará exceção e sairemos.
        while True:
            try:
                await ws.receive_text()
            except Exception:
                # conexão fechada pelo cliente
                break
    finally:
        clients.discard(ws)

# ------------------------------------------------------------------------------
# SSE (fallback)
# ------------------------------------------------------------------------------
@app.get("/sse")
async def sse():
    async def gen():
        # heartbeat inicial
        yield f"data: {json.dumps({'type': 'heartbeat', 'now': now_ms()})}\n\n"
        while True:
            await asyncio.sleep(10)
            yield f"data: {json.dumps({'type': 'heartbeat', 'now': now_ms()})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")

# ------------------------------------------------------------------------------
# Loop do jogo Crash
# ------------------------------------------------------------------------------
async def game_loop():
    """
    Ciclo:
      - preparing (barra de preparo)
      - running (multiplicador sobe até o crash)
      - crashed (pausa curta)
    O servidor sempre envia startedAt/endsAt (ms) para a UI animar a barrinha.
    """
    PREP = 3.5  # segundos
    RUN_MAX_VISUAL = 8.0  # limite visual (a rodada pode crashar antes)

    while True:
        # -------- PREPARING
        start = now_ms()
        ends = start + int(PREP * 1000)
        await broadcast({
            "type": "phase",
            "phase": "preparing",
            "startedAt": start,
            "endsAt": ends,
            "now": now_ms()
        })
        while now_ms() < ends:
            await asyncio.sleep(0.1)

        # -------- RUNNING
        start = now_ms()

        # Sorteio do ponto de crash (exemplo simples, ajuste como quiser)
        # x(t) = 1.06^t  => t_crash = ln(x)/ln(1.06)
        # Aqui limitamos entre ~1.10x e 10x só para demonstração
        frac = time.time() % 1.0
        crash_x = max(1.10, min(10.0, 1.02 ** int(100 + 400 * frac)))
        t_crash = math.log(crash_x) / math.log(1.06)
        ends = start + int(min(RUN_MAX_VISUAL, t_crash + 0.2) * 1000)

        await broadcast({
            "type": "phase",
            "phase": "running",
            "startedAt": start,
            "endsAt": ends,
            "now": now_ms()
        })

        t0 = time.time()
        while True:
            t = time.time() - t0
            x = pow(1.06, t)
            if x >= crash_x:
                break
            await broadcast({"type": "tick", "x": x, "now": now_ms()})
            await asyncio.sleep(0.05)

               # -------- CRASHED
        await broadcast({
            "type": "phase",
            "phase": "crashed",
            "startedAt": now_ms(),
            "endsAt": now_ms() + 800,
            "crashX": crash_x,           # <<<<<< envia o crash desta rodada
            "now": now_ms()
        })
        await asyncio.sleep(0.8)


# ------------------------------------------------------------------------------
# Startup: inicia o loop do jogo
# ------------------------------------------------------------------------------
@app.on_event("startup")
async def _startup():
    asyncio.create_task(game_loop())

