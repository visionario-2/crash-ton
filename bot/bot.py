import asyncio, os
from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command

TOKEN = os.getenv("TOKEN")
WEBAPP_URL = os.getenv("WEBAPP_URL")  # URL do MiniApp (frontend)
BACKEND_URL = os.getenv("BACKEND_URL")  # opcional para comandos de saldo etc.

bot = Bot(TOKEN, parse_mode="HTML")
dp = Dispatcher()

@dp.message(Command("start"))
async def start(m: types.Message):
    kb = types.ReplyKeyboardMarkup(
        keyboard=[[
            types.KeyboardButton(text="🎮 Abrir Crash", web_app=types.WebAppInfo(url=WEBAPP_URL))
        ],[
            types.KeyboardButton(text="💰 Depositar (TON)")
        ]],
        resize_keyboard=True
    )
    await m.answer(
        "Bem-vindo ao <b>Crash TON</b>!\n\nToque em <b>🎮 Abrir Crash</b> para jogar.",
        reply_markup=kb
    )

@dp.message(lambda msg: msg.text == "💰 Depositar (TON)")
async def deposit_info(m: types.Message):
    tg_id = str(m.from_user.id)
    # gere a mensagem-comentário única:
    comment = f"dep_tg_{tg_id}"
    ton_addr = os.getenv("TON_APP_ADDRESS", "SEU_ENDERECO_TON_AQUI")
    txt = (
        "Para depositar, envie TON para:\n"
        f"<code>{ton_addr}</code>\n\n"
        "No campo <b>Comment</b> da transação, use exatamente:\n"
        f"<code>{comment}</code>\n\n"
        "Assim que a rede confirmar, seu saldo será creditado automaticamente. ✅"
    )
    await m.answer(txt)

async def main():
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
