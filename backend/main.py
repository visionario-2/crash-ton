# backend/main.py — FastAPI + WS + SSE + Frontend estático
import os
import asyncio
import json
import math
import time
import random
from typing import Set, Dict
from collections import deque

from fastapi import FastAPI, WebSocket, HTTPException, WebSocketDisconnect
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
def now_ms() -> int:
    return int(time.time() * 1000)

def now_s() -> float:
    return time.time()

# Conexões de clientes (WS /stream e /ws compartilham a mesma lista)
clients: Set[WebSocket] = set()

async def broadcast(obj: Dict):
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

HISTORY = deque(maxlen=50)  # últimas 50 rodadas (floats)

# Saldos e apostas (demo)
balances: Dict[str, float] = {}                      # tg_id -> TON
bets: Dict[int, Dict[str, Dict]] = {}                # round_id -> tg_id -> {amount, cashed, cash_x}
state_lock = asyncio.Lock()

# ---------------------- NOVO MOTOR DE JOGO (sincronizado) ---------------------
class GameState:
    # curva em 2 trechos: 1→2x ~10s; depois acelera 2→100x ~20s
    a: float = math.log(2) / 10.0
    b: float = math.log(100/2) / 20.0
    max_x: float = 100.0

    # fase atual
    phase: str = "cooldown"            # cooldown | running | crashed
    round_id: int = 0
    round_start_ts: float = 0.0        # epoch seconds quando começou running
    cooldown_until: float = 0.0        # epoch seconds quando termina cooldown
    crash_target: float = 2.0          # multiplicador onde irá crashar

    cooldown_sec: int = 20

    def x_from_t(self, t_sec: float) -> float:
        """Multiplicador no tempo t (segundos) considerando a curva por trechos."""
        if t_sec <= 10.0:
            return min(self.max_x, math.exp(self.a * t_sec))
        else:
            return min(self.max_x, 2.0 * math.exp(self.b * (t_sec - 10.0)))

state = GameState()

def pick_crash_target() -> float:
    """Distribuição com muitas quedas baixas e algumas altas (mix simples)."""
    r = random.random()
    if r < 0.70:   # 70% entre 1.01 e 4
        return 1.01 + random.random() * (4.0 - 1.01)
    if r < 0.95:   # 25% entre 4 e 10
        return 4.0 + random.random() * (10.0 - 4.0)
    return 10.0 + random.random() * (state.max_x - 10.0)  # 5% 10–100

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
# Saldo/Aposta/Retirada (mock p/ testes)
# ------------------------------------------------------------------------------
@app.get("/balance/{tg_id}")
def get_balance(tg_id: str):
    return {"balance_ton": float(balances.get(tg_id, 0.0))}

@app.post("/deposit_mock")
async def deposit_mock(payload: dict):
    tg_id = str(payload.get("tg_id"))
    amount = float(payload.get("amount", 0))
    if not tg_id:
        raise HTTPException(400, "missing tg_id")
    if amount <= 0:
        raise HTTPException(400, "amount must be > 0")
    balances[tg_id] = balances.get(tg_id, 0.0) + amount
    return {"ok": True, "balance_ton": balances[tg_id]}

@app.post("/bet")
async def make_bet(payload: dict):
    tg_id = str(payload.get("tg_id"))
    amount = float(payload.get("amount", 0))
    if not tg_id:
        raise HTTPException(400, "missing tg_id")
    if amount <= 0:
        raise HTTPException(400, "amount must be > 0")
    async with state_lock:
        if state.phase != "cooldown":
            raise HTTPException(400, "bets only during cooldown")
        if balances.get(tg_id, 0.0) < amount:
            raise HTTPException(400, "insufficient balance")
        balances[tg_id] = balances.get(tg_id, 0.0) - amount
        rmap = bets.setdefault(state.round_id, {})
        if tg_id in rmap:
            raise HTTPException(400, "already bet this round")
        rmap[tg_id] = {"amount": amount, "cashed": False, "cash_x": None}
    return {"ok": True, "balance_ton": balances.get(tg_id, 0.0)}

@app.post("/cashout")
async def cashout(payload: dict):
    tg_id = str(payload.get("tg_id"))
    if not tg_id:
        raise HTTPException(400, "missing tg_id")
    async with state_lock:
        if state.phase != "running":
            raise HTTPException(400, "cashout only in running")
        rb = bets.get(state.round_id, {}).get(tg_id)
        if not rb:
            raise HTTPException(400, "no bet in this round")
        if rb["cashed"]:
            raise HTTPException(400, "already cashed out")
        t_sec = max(0.0, now_s() - state.round_start_ts)
        x = min(state.x_from_t(t_sec), state.crash_target)
        payout = rb["amount"] * x
        rb["cashed"] = True
        rb["cash_x"] = x
        balances[tg_id] = balances.get(tg_id, 0.0) + payout
    return {"ok": True, "multiplier": x, "payout": payout, "balance_ton": balances.get(tg_id, 0.0)}

# ------------------------------------------------------------------------------
# WebSocket (novo) — /ws
# ------------------------------------------------------------------------------
@app.websocket("/ws")
async def ws(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    try:
        # Na conexão, envia o estado atual
        if state.phase == "cooldown":
            await ws.send_text(json.dumps({
                "type": "phase",
                "phase": "cooldown",
                "cooldown_until": state.cooldown_until
            }))
        elif state.phase == "running":
            await ws.send_text(json.dumps({
                "type": "phase",
                "phase": "running",
                "round_start_ts": state.round_start_ts,
                "crash_target": state.crash_target
            }))
        # Mantém viva
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        clients.discard(ws)

# ------------------------------------------------------------------------------
# WebSocket antigo (/stream) — mantido como compat
# ------------------------------------------------------------------------------
@app.websocket("/stream")
async def stream(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    try:
        while True:
            await ws.receive_text()
    except Exception:
        pass
    finally:
        clients.discard(ws)

# ------------------------------------------------------------------------------
# SSE (fallback)
# ------------------------------------------------------------------------------
@app.get("/sse")
async def sse():
    async def gen():
        yield f"data: {json.dumps({'type': 'heartbeat', 'now': now_ms()})}\n\n"
        while True:
            await asyncio.sleep(10)
            yield f"data: {json.dumps({'type': 'heartbeat', 'now': now_ms()})}\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream")

# ------------------------------------------------------------------------------
# Loop do jogo (servidor é o relógio)
# ------------------------------------------------------------------------------
async def game_loop():
    """
    Ciclo:
      cooldown (apostas) -> running (curva) -> crash -> cooldown ...
    Servidor transmite:
      - phase/cooldown: {"type":"phase","phase":"cooldown","cooldown_until": epoch_seconds}
      - phase/running : {"type":"phase","phase":"running","round_start_ts": epoch_seconds,"crash_target": x}
      - tick          : {"type":"tick","x": valor}
      - crash         : {"type":"crash","x": valor}
    """
    while True:
        # ---------------- COOLDOWN ----------------
        state.phase = "cooldown"
        state.round_id += 1
        bets.setdefault(state.round_id, {})
        state.cooldown_until = now_s() + state.cooldown_sec
        await broadcast({
            "type": "phase",
            "phase": "cooldown",
            "cooldown_until": state.cooldown_until
        })
        # atualiza contagem a cada 0.3s
        while now_s() < state.cooldown_until:
            await broadcast({"type": "cooldown", "left": state.cooldown_until - now_s()})
            await asyncio.sleep(0.3)

        # ---------------- RUNNING -----------------
        state.phase = "running"
        state.round_start_ts = now_s()
        state.crash_target = pick_crash_target()
        await broadcast({
            "type": "phase",
            "phase": "running",
            "round_start_ts": state.round_start_ts,
            "crash_target": state.crash_target
        })

        # loop ~30 FPS enviando x(t)
        while True:
            t = now_s() - state.round_start_ts
            x = state.x_from_t(t)
            if x >= state.crash_target:
                break
            await broadcast({"type": "tick", "x": x})
            await asyncio.sleep(1/30)

        # ---------------- CRASH -------------------
        x_final = max(state.crash_target, state.x_from_t(now_s() - state.round_start_ts))
        await broadcast({"type": "crash", "x": x_final})
        HISTORY.append(float(x_final))

        # pequena pausa pós-crash
        await asyncio.sleep(1.0)

# ------------------------------------------------------------------------------
# Startup: inicia o loop do jogo
# ------------------------------------------------------------------------------
@app.on_event("startup")
async def _startup():
    asyncio.create_task(game_loop())
