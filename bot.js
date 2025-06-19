require("dotenv").config();
const { Telegraf } = require("telegraf");
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const main = require("./main"); // función que generará el texto

bot.command("pool", async (ctx) => {
  try {
    ctx.reply("🎡 Huele a Flywheel...");
    const mensaje = await main();
    await ctx.reply(mensaje, { parse_mode: "Markdown" });
  } catch (err) {
    console.error(err);
    ctx.reply("❌ Error al generar el reporte.");
  }
});

bot.launch();
console.log("🤖 Bot de Telegram iniciado.");
