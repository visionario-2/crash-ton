import asyncio
import os

from aiogram import Bot, Dispatcher, F, types
from aiogram.enums import ParseMode
from aiogram.client.default import DefaultBotProperties
from aiogram.filters import Command
from aiogram.types import ReplyKeyboardMarkup, KeyboardButton, WebAppInfo

TOKEN = os.getenv("TOKEN")
WEBAPP_URL = os.getenv("WEBAPP_URL")  # URL do MiniApp (frontend)
BACKEND_URL = os.getenv("BACKEND_URL")  # opcional para comandos de saldo etc.
TON_APP_ADDRESS = os.getenv("TON_APP_ADDRESS", "SEU_ENDERECO_TON_AQUI")

if not TOKEN:
    raise RuntimeError("Env TOKEN não definido no Render (bot).")

# >>> mudança importante no aiogram v3:
bot = Bot(TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
dp = Dispatcher()


@dp.message(Command("start"))
async def cmd_start(m: types.Message):
    if not WEBAPP_URL:
        await m.answer("⚠️ WEBAPP_URL não configurado. Defina a env no Render.")
        return

    kb = ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="🎮 Abrir Crash", web_app=WebAppInfo(url=WEBAPP_URL))],
            [KeyboardButton(text="💰 Depositar (TON)")]
        ],
        resize_keyboard=True
    )
    await m.answer(
        "Bem-vindo ao <b>Crash TON</b>!\n\nToque em <b>🎮 Abrir Crash</b> para jogar.",
        reply_markup=kb
    )


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


async def main():
    print("Starting bot polling…")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
