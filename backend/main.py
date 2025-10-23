# server.py (FastAPI + WebSocket + SSE)
import asyncio, json, math, time
from typing import Set
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import StreamingResponse

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

clients: Set[WebSocket] = set()

def now_ms(): return int(time.time() * 1000)

async def broadcast(obj):
    msg = json.dumps(obj)
    dead = []
    for ws in list(clients):
        try:
            await ws.send_text(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)

@app.get("/health")
def health(): return {"ok": True, "now": now_ms()}

@app.websocket("/stream")
async def stream(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    try:
        while True:
            # ping-keepalive (cliente não precisa responder)
            await ws.receive_text()
    except Exception:
        pass
    finally:
        clients.discard(ws)

@app.get("/sse")
async def sse():
    async def gen():
        # heartbeat inicial
        yield f"data: {json.dumps({'type':'heartbeat','now':now_ms()})}\n\n"
        while True:
            await asyncio.sleep(10)
            yield f"data: {json.dumps({'type':'heartbeat','now':now_ms()})}\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream")

async def game_loop():
    PREP = 3.5   # s
    RUN  = 8.0   # s (máx visual; o crash real pode ocorrer antes)
    while True:
        # PREPARING
        start = now_ms()
        ends  = start + int(PREP * 1000)
        await broadcast({"type":"phase","phase":"preparing","startedAt":start,"endsAt":ends,"now":now_ms()})
        while now_ms() < ends:
            await asyncio.sleep(0.1)

        # RUNNING
        start = now_ms()
        # sorteia ponto de crash (ex.: 1.2x a 10x)
        crash_x = max(1.05, min(10.0, 1.02 ** int(100 + 400 * (time.time()%1))))
        # tempo até o crash pela curva x(t) = 1.06^t  =>  t = ln(x)/ln(1.06)
        t_crash = math.log(crash_x) / math.log(1.06)
        ends = start + int(min(RUN, t_crash + 0.2) * 1000)
        await broadcast({"type":"phase","phase":"running","startedAt":start,"endsAt":ends,"now":now_ms()})

        t0 = time.time()
        while True:
            t = time.time() - t0
            x = pow(1.06, t)
            if x >= crash_x:
                break
            await broadcast({"type":"tick","x":x,"now":now_ms()})
            await asyncio.sleep(0.05)

        # CRASHED
        await broadcast({"type":"phase","phase":"crashed","startedAt":now_ms(),"endsAt":now_ms()+800,"now":now_ms()})
        await asyncio.sleep(0.8)

@app.on_event("startup")
async def _startup():
    asyncio.create_task(game_loop())
