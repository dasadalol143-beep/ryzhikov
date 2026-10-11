// Cloudflare Workers: /api/* обрабатывает та же логика, что и Netlify Function, статика — из public/.
import { createHandler, loadAll, recipientsOf } from "../lib/core.mjs";
import { runDaily } from "../lib/report.mjs";
import { runReminders } from "../lib/reminders.mjs";
import { telegram } from "../lib/telegram.mjs";

function kvStore(kv) {
  return {
    getJSON: (key) => kv.get(key, { type: "json" }),
    setJSON: (key, value) => kv.put(key, JSON.stringify(value)),
    delete: (key) => kv.delete(key),
    list: async (prefix) => {
      const keys = [];
      let cursor;
      do {
        const page = await kv.list({ prefix, cursor });
        keys.push(...page.keys.map((k) => k.name));
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return keys;
    },
  };
}

export default {
  async fetch(req, env) {
    if (new URL(req.url).pathname.startsWith("/api/")) {
      return createHandler({ store: kvStore(env.CRM), env })(req);
    }
    return env.ASSETS.fetch(req);
  },

  // Каждое утро: сводка в бота всем с доступом, по понедельникам ещё и бэкап админам.
  async scheduled(event, env, ctx) {
    // Каждую минуту — напоминания из бота.
    if (event.cron !== "57 5 * * *") {
      await runReminders({ store: kvStore(env.CRM), tg: telegram(env.BOT_TOKEN), appUrl: env.APP_URL, now: event.scheduledTime });
      return;
    }
    const { offers, settings, leads, access } = await loadAll(kvStore(env.CRM));
    const results = await runDaily({
      tg: telegram(env.BOT_TOKEN),
      recipients: recipientsOf(env, access),
      leads,
      offers,
      settings,
      appUrl: env.APP_URL,
      now: event.scheduledTime,
    });
    console.log(JSON.stringify(results));
  },
};
