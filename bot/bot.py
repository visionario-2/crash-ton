import asyncio, os, httpx
from aiogram import Bot, Dispatcher, F, types
from aiogram.enums import ParseMode
from aiogram.client.default import DefaultBotProperties
from aiogram.filters import Command
from aiogram.types import ReplyKeyboardMarkup, KeyboardButton, WebAppInfo

TOKEN = os.getenv("TOKEN")
WEBAPP_URL = os.getenv("WEBAPP_URL")
BACKEND_URL = os.getenv("BACKEND_URL")
TON_APP_ADDRESS = os.getenv("TON_APP_ADDRESS", "SEU_ENDERECO_TON_AQUI")

ADMIN_IDS = [s.strip() for s in (os.getenv("ADMIN_IDS","").split(",")) if s.strip()]
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")

if not TOKEN:
    raise RuntimeError("Env TOKEN não definido.")
if not WEBAPP_URL:
    print("AVISO: WEBAPP_URL não definido.")

bot = Bot(TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
dp = Dispatcher()

# --- helpers HTTP ---
async def get_json(path):
    async with httpx.AsyncClient(timeout=15) as cli:
        r = await cli.get(BACKEND_URL.rstrip("/") + path)
        r.raise_for_status()
        return r.json()

async def post_json(path, payload):
    async with httpx.AsyncClient(timeout=15) as cli:
        r = await cli.post(BACKEND_URL.rstrip("/") + path, json=payload)
        r.raise_for_status()
        return r.json()

# --- comandos ---
@dp.message(Command("start"))
async def cmd_start(m: types.Message):
    kb = ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="🎮 Abrir Crash", web_app=WebAppInfo(url=WEBAPP_URL))],
            [KeyboardButton(text="💰 Depositar (TON)")]
        ],
        resize_keyboard=True
    )
    await m.answer("Bem-vindo ao <b>Crash TON</b>!\n\nToque em <b>🎮 Abrir Crash</b> para jogar.", reply_markup=kb)

@dp.message(F.text == "💰 Depositar (TON)")
async def deposit_info(m: types.Message):
    tg_id = str(m.from_user.id)
    comment = f"dep_tg_{tg_id}"
    txt = (
        "Para depositar, envie TON para:\n"
        f"<code>{TON_APP_ADDRESS}</code>\n\n"
        "No campo <b>Comment</b> da transação, use exatamente:\n"
        f"<code>{comment}</code>\n\n"
        "Assim que a rede confirmar, seu saldo será creditado automaticamente. ✅"
    )
    await m.answer(txt)

@dp.message(Command("saldo"))
async def cmd_saldo(m: types.Message):
    tg_id = str(m.from_user.id)
    try:
        data = await get_json(f"/balance/{tg_id}")
        bal = data.get("balance_ton", 0)
        await m.answer(f"💳 Seu saldo: <b>{bal:.6f} TON</b>")
    except Exception as e:
        await m.answer(f"❌ Erro ao consultar saldo.\n<code>{e}</code>")

@dp.message(Command("credit"))
async def cmd_credit(m: types.Message):
    # uso: /credit <tg_id> <valor>
    uid = str(m.from_user.id)
    if uid not in ADMIN_IDS:
        await m.answer("🚫 Comando restrito a administradores.")
        return

    args = (m.text or "").split()
    if len(args) != 3:
        await m.answer("Uso: <code>/credit &lt;tg_id&gt; &lt;valor&gt;</code>")
        return
    tgt, amount_s = args[1], args[2]
    try:
        amount = float(amount_s)
        if amount <= 0:
            raise ValueError
    except:
        await m.answer("Valor inválido. Ex.: <code>/credit 123456789 10</code>")
        return

    try:
        res = await post_json("/admin/credit", {"token": ADMIN_TOKEN, "tg_id": tgt, "amount": amount})
        if res.get("ok"):
            await m.answer(f"✅ Creditados <b>{amount:.6f} TON</b> para <code>{tgt}</code>.")
        else:
            await m.answer(f"❌ Falha: {res}")
    except Exception as e:
        await m.answer(f"❌ Erro: <code>{e}</code>")

async def main():
    print("Starting bot polling…")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
