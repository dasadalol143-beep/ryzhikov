// Cloudflare Workers: /api/* обрабатывает та же логика, что и Netlify Function, статика — из public/.
import { createHandler } from "../lib/core.mjs";

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
};
