import os, asyncio, sqlite3, hashlib, time, json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import httpx

from utils_fair import crash_point

# ===== CONFIG =====
DB = "/var/data/crash.db"   # garanta que o Disk está montado em /var/data
ROUND_PREP_SECONDS = 10
HOUSE_EDGE = 0.01

TON_APP_ADDRESS = os.getenv("TON_APP_ADDRESS", "")                 # endereço TON que recebe depósitos
TONCENTER_API_KEY = os.getenv("TONCENTER_API_KEY", "")             # opcional: chave para API (toncenter / tonapi)
TONCENTER_URL = os.getenv("TONCENTER_URL", "https://toncenter.com/api/v3/")  # compatível com /transactions
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")                         # <<< coloque no Render (Web Service -> Environment)

# ===== ESTADO ATUAL (para fallback HTTP no frontend) =====
CURRENT_STATE = {
    "phase": "preparing",
    "multiplier": 1.0,
    "crash": None,
    "round_id": None,
    "updated_at": time.time(),
}

# ===== APP =====
app = FastAPI(title="Crash TON Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

def db():
    con = sqlite3.connect(DB, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con

# init DB + seed
with db() as con, open(os.path.join(os.path.dirname(__file__), "schema.sql")) as f:
    con.executescript(f.read())
    cur = con.execute("SELECT id FROM seeds WHERE active=1").fetchone()
    if not cur:
        server_seed = os.urandom(32).hex()
        server_seed_hash = hashlib.sha256(server_seed.encode()).hexdigest()
        con.execute("INSERT INTO seeds(server_seed, server_seed_hash, active) VALUES(?,?,1)",
                    (server_seed, server_seed_hash))
        con.commit()

# ===== MODELOS =====
class BetReq(BaseModel):
    tg_id: str
    amount: float
    auto_cashout: Optional[float] = None

class CashoutReq(BaseModel):
    tg_id: str

# --- Admin ---
class AdminCreditReq(BaseModel):
    token: str
    tg_id: str
    amount: float

# ===== HELPERS =====
def get_active_seed(con):
    return con.execute("SELECT * FROM seeds WHERE active=1").fetchone()

def get_or_create_user(con, tg_id: str):
    u = con.execute("SELECT id FROM users WHERE tg_id=?", (tg_id,)).fetchone()
    if not u:
        con.execute("INSERT INTO users(tg_id) VALUES(?)", (tg_id,))
        con.execute("INSERT INTO balances(user_id) VALUES(last_insert_rowid())")
        con.commit()
        u = con.execute("SELECT id FROM users WHERE tg_id=?", (tg_id,)).fetchone()
    return u

def new_round(con):
    seed = get_active_seed(con)
    client_seed = str(int(time.time()))
    nonce = con.execute("SELECT COUNT(*) c FROM rounds WHERE seed_id=?", (seed["id"],)).fetchone()["c"] + 1
    crash = crash_point(seed["server_seed"], client_seed, nonce)
    cur = con.execute("INSERT INTO rounds(seed_id, client_seed, nonce, crash) VALUES(?,?,?,?)",
                      (seed["id"], client_seed, nonce, crash))
    con.commit()
    return {"round_id": cur.lastrowid, "crash": crash, "client_seed": client_seed,
            "nonce": nonce, "seed_hash": seed["server_seed_hash"]}

# ===== WEBSOCKET =====
clients: List[WebSocket] = []

async def broadcast(msg: dict):
    dead = []
    for ws in clients:
        try:
            await ws.send_text(json.dumps(msg))
        except:
            dead.append(ws)
    for d in dead:
        if d in clients: clients.remove(d)

@app.websocket("/ws")
async def ws(ws: WebSocket):
    await ws.accept()
    clients.append(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        if ws in clients: clients.remove(ws)

# ===== ENDPOINTS PÚBLICOS =====
@app.get("/")
def root():
    return {"ok": True, "service": "backend"}

@app.get("/seed/hash")
def seed_hash():
    with db() as con:
        s = get_active_seed(con)
        return {"server_seed_hash": s["server_seed_hash"]}

# >>> estado atual para o frontend (fallback HTTP)
@app.get("/state")
def http_state():
    return CURRENT_STATE

@app.post("/bet")
def place_bet(req: BetReq):
    if req.amount <= 0:
        raise HTTPException(400, "Valor inválido.")
    with db() as con:
        u = get_or_create_user(con, req.tg_id)
        bal = con.execute("SELECT ton_balance FROM balances WHERE user_id=?", (u["id"],)).fetchone()["ton_balance"]
        if bal < req.amount:
            raise HTTPException(400, "Saldo insuficiente.")
        rid = con.execute("SELECT id FROM rounds ORDER BY id DESC LIMIT 1").fetchone()["id"]
        con.execute("INSERT INTO bets(round_id,user_id,amount,auto_cashout) VALUES(?,?,?,?)",
                    (rid, u["id"], req.amount, req.auto_cashout))
        con.execute("UPDATE balances SET ton_balance = ton_balance - ? WHERE user_id=?",
                    (req.amount, u["id"]))
        con.commit()
        return {"ok": True, "round_id": rid}

@app.post("/cashout")
def cashout(req: CashoutReq):
    with db() as con:
        u = con.execute("SELECT id FROM users WHERE tg_id=?", (req.tg_id,)).fetchone()
        if not u:
            raise HTTPException(404, "Usuário não encontrado.")
        last_round = con.execute("SELECT * FROM rounds ORDER BY id DESC LIMIT 1").fetchone()
        if last_round["ended_at"] is not None:
            raise HTTPException(400, "Rodada encerrada.")
        bet = con.execute("SELECT * FROM bets WHERE round_id=? AND user_id=? AND cashed_out_at IS NULL",
                          (last_round["id"], u["id"])).fetchone()
        if not bet:
            raise HTTPException(400, "Sem aposta ativa.")
        # MVP: cashout em 1.5x (placeholder)
        cash_mult = 1.50
        payout = round(bet["amount"] * cash_mult, 6)
        con.execute("UPDATE bets SET cashed_out_at=? WHERE id=?", (cash_mult, bet["id"]))
        con.execute("UPDATE balances SET ton_balance = ton_balance + ? WHERE user_id=?", (payout, u["id"]))
        con.commit()
        return {"ok": True, "payout": payout, "multiplier": cash_mult}

@app.get("/history")
def history(limit: int = 15):
    with db() as con:
        rows = con.execute(
            "SELECT crash FROM rounds WHERE ended_at IS NOT NULL ORDER BY id DESC LIMIT ?",
            (limit,)
        ).fetchall()
        return {"crashes": [float(r["crash"]) for r in rows][::-1]}

# ===== ADMIN =====
@app.get("/balance/{tg_id}")
def get_balance(tg_id: str):
    with db() as con:
        u = get_or_create_user(con, tg_id)
        bal = con.execute("SELECT ton_balance FROM balances WHERE user_id=?", (u["id"],)).fetchone()["ton_balance"]
        return {"tg_id": tg_id, "balance_ton": float(bal)}

@app.post("/admin/credit")
def admin_credit(req: AdminCreditReq):
    if not ADMIN_TOKEN or req.token != ADMIN_TOKEN:
        raise HTTPException(403, "Forbidden")
    if req.amount <= 0:
        raise HTTPException(400, "amount deve ser > 0")
    with db() as con:
        u = get_or_create_user(con, req.tg_id)
        con.execute("UPDATE balances SET ton_balance = ton_balance + ? WHERE user_id=?", (req.amount, u["id"]))
        con.execute(
            "INSERT INTO txs(user_id,direction,amount,status,tx_hash,comment) VALUES(?,?,?,?,?,?)",
            (u["id"], 'deposit', req.amount, 'confirmed', None, 'admin_credit')
        )
        con.commit()
    return {"ok": True, "credited": float(req.amount), "tg_id": req.tg_id}

# ===== GAME LOOP =====
async def round_loop():
    await asyncio.sleep(1)
    while True:
        try:
            # ---- prepara nova rodada
            with db() as con:
                rinfo = new_round(con)

            prep_end = time.time() + ROUND_PREP_SECONDS

            # atualiza estado (preparing)
            CURRENT_STATE.update({
                "phase": "preparing",
                "multiplier": 1.0,
                "crash": float(rinfo["crash"]),
                "round_id": int(rinfo["round_id"]),
                "updated_at": time.time(),
            })

            # broadcast de preparing com contagem
            while time.time() < prep_end:
                await broadcast({
                    "type":"state",
                    "phase":"preparing",
                    "seed_hash": rinfo["seed_hash"],
                    "time_left": prep_end - time.time()
                })
                await asyncio.sleep(0.2)

            # ---- corrida
            start = time.time()
            mult = 1.0
            crash = rinfo["crash"]
            rid = rinfo["round_id"]

            while True:
                # SUBSTITUA dentro do while True do running:
                dt = time.time() - start
                # crescimento ~1% a cada 0,05s → ~10% por segundo (bem suave)
                mult = round(1.01 ** (dt * 20), 2)

                crashed = mult >= crash
                if crashed:
                    mult = crash


                # estado "running"
                CURRENT_STATE.update({
                    "phase": "running",
                    "multiplier": float(mult),
                    "crash": float(crash),
                    "round_id": int(rid),
                    "updated_at": time.time(),
                })

                await broadcast({
                    "type":"tick",
                    "phase":"running",
                    "round_id": rid,
                    "multiplier": mult,
                    "crash": crash
                })
                await asyncio.sleep(0.05)
                if crashed or dt > 12:
                    break

            # ---- terminou (crashed)
            with db() as con:
                con.execute("UPDATE rounds SET ended_at=CURRENT_TIMESTAMP WHERE id=?", (rid,))
                con.commit()

            CURRENT_STATE.update({
                "phase": "crashed",
                "multiplier": float(mult),
                "crash": float(crash),
                "round_id": int(rid),
                "updated_at": time.time(),
            })

            await broadcast({"type":"state","phase":"crashed","round_id":rid,"crash":crash})
            await asyncio.sleep(2)

        except Exception as e:
            await broadcast({"type":"error","message":str(e)})
            await asyncio.sleep(2)

# ===== DEPOSIT WATCHER (TON) =====
async def ton_deposit_watcher():
    if not TON_APP_ADDRESS:
        return
    seen = set()
    await asyncio.sleep(3)
    while True:
        try:
            params = {"account": TON_APP_ADDRESS, "limit": 20}
            headers = {"X-API-Key": TONCENTER_API_KEY} if TONCENTER_API_KEY else {}
            async with httpx.AsyncClient(timeout=20) as cli:
                r = await cli.get(TONCENTER_URL.rstrip("/") + "/transactions", params=params, headers=headers)
                r.raise_for_status()
                data = r.json()

            txs = data.get("transactions") or data.get("result") or data.get("data") or []

            def _nanotons_to_ton(v):
                try:
                    return float(v) / 1e9
                except Exception:
                    return 0.0

            with db() as con:
                for tx in txs:
                    h = (
                        tx.get("hash")
                        or (tx.get("transaction_id") or {}).get("hash")
                        or (tx.get("id"))
                    )
                    if not h or h in seen:
                        continue
                    seen.add(h)

                    in_msg = tx.get("in_msg") or tx.get("inMessage") or tx.get("in_msg_full") or {}

                    comment = (
                        (in_msg.get("message") or "")
                        or ((in_msg.get("decoded_body") or {}).get("comment") or "")
                        or (((in_msg.get("decoded") or {}).get("body") or {}).get("text") or "")
                    ).strip()

                    value_ton = _nanotons_to_ton(in_msg.get("value"))

                    if not comment or value_ton <= 0:
                        continue

                    if comment.startswith("dep_tg_"):
                        tg_id = comment.replace("dep_tg_", "", 1).strip()
                        u = get_or_create_user(con, tg_id)
                        con.execute("UPDATE balances SET ton_balance = ton_balance + ? WHERE user_id=?",
                                    (value_ton, u["id"]))
                        con.execute(
                            "INSERT INTO txs(user_id,direction,amount,status,tx_hash,comment) VALUES(?,?,?,?,?,?)",
                            (u["id"], "deposit", value_ton, "confirmed", h, comment),
                        )
                        con.commit()

        except Exception as e:
            print("Deposit watcher error:", e)

        await asyncio.sleep(15)

# ===== STARTUP =====
@app.on_event("startup")
async def _startup():
    asyncio.create_task(round_loop())
    asyncio.create_task(ton_deposit_watcher())

