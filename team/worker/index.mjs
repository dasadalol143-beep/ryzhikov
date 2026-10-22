// Cloudflare Worker: /api/* — логика команды, остальное — статика из public/.
import { createHandler } from "../src/api.mjs";
import { d1Store } from "../src/store.mjs";
import { telegram } from "../src/telegram.mjs";
import { runReminders, runMorning, runEvening, runPayoutReminder } from "../src/bot.mjs";

export default {
  async fetch(req, env) {
    if (new URL(req.url).pathname.startsWith("/api/")) return createHandler({ store: d1Store(env.DB), env })(req);
    return env.ASSETS.fetch(req);
  },

  async scheduled(event, env) {
    if (!env.BOT_TOKEN) return;
    const ctx = { store: d1Store(env.DB), env, tg: telegram(env.BOT_TOKEN), appUrl: env.APP_URL, now: event.scheduledTime };
    if (event.cron === "57 5 * * *") return console.log(JSON.stringify(await runMorning(ctx)));
    if (event.cron === "0 18 * * *") return console.log(JSON.stringify(await runEvening(ctx)));
    await runReminders(ctx);
    await runPayoutReminder(ctx).catch((e) => console.log("payouts", e.message));
    const { retryArchive } = await import("../src/recordings.mjs");
    await retryArchive(ctx).catch((e) => console.log("rec-archive", e.message));
    const { runDataFixes } = await import("../src/api.mjs");
    await runDataFixes(ctx).catch((e) => console.log("fixes", e.message));
  },
};
