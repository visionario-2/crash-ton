# backend/main.py — FastAPI + WebSocket + SSE + Frontend estático
import os
import asyncio
import json
import math
import time
import random
from typing import Set
from collections import deque

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
# Frontend (caminhos)
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
# Estado do jogo / utilidades
# ------------------------------------------------------------------------------
clients: Set[WebSocket] = set()
HISTORY = deque(maxlen=50)  # últimas 50 rodadas

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
# Health & History
# ------------------------------------------------------------------------------
@app.get("/health")
def health():
    return {"ok": True, "now": now_ms()}

@app.get("/history")
def history(limit: int = 10):
    data = list(HISTORY)[-limit:]
    return {"crashes": data[::-1]}  # mais recente primeiro

# ------------------------------------------------------------------------------
# WebSocket de stream
# ------------------------------------------------------------------------------
@app.websocket("/stream")
async def stream(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    try:
        # Mantém a conexão viva aguardando mensagens do cliente.
        while True:
            try:
                await ws.receive_text()
            except Exception:
                break
    finally:
        clients.discard(ws)

# ------------------------------------------------------------------------------
# SSE (fallback)
# ------------------------------------------------------------------------------
@app.get("/sse")
async def sse():
    async def gen():
        # heartbeat inicial e a cada 10s
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
    O servidor envia startedAt/endsAt (ms) para a UI animar a barrinha.
    """
    PREP = 20           # s de preparação (tempo para apostar)
    RUN_MAX_VISUAL = 8.0 # limite visual (a rodada pode crashar antes)
    HOUSE_EDGE = 0.03    # ~3% de edge da casa
    CAP = 50.0           # teto de multiplicador
    BETA = 0.90          # <1 puxa a cauda para baixo (0.85~0.95 bom)

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
            await asyncio.sleep(0.05)

        # -------- RUNNING
        start = now_ms()

        # Distribuição "tipo Aviator" com house edge e cauda longa
        r = random.random()  # 0..1
        raw = ((1.0 - HOUSE_EDGE) / max(1e-12, (1.0 - r))) ** BETA
        crash_x = max(1.01, min(CAP, raw))

        # Tempo até o crash pela curva x(t) = 1.06^t  =>  t = ln(x)/ln(1.06)
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
        HISTORY.append(float(crash_x))  # salva no histórico
        await broadcast({
            "type": "phase",
            "phase": "crashed",
            "startedAt": now_ms(),
            "endsAt": now_ms() + 800,
            "crashX": crash_x,
            "now": now_ms()
        })
        await asyncio.sleep(0.8)

# ------------------------------------------------------------------------------
# Startup: inicia o loop do jogo
# ------------------------------------------------------------------------------
@app.on_event("startup")
async def _startup():
    asyncio.create_task(game_loop())

