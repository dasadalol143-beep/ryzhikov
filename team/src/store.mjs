// Хранилище документов: kind + id → JSON. На Cloudflare это D1 (SQLite), в тестах — память.
// D1 вместо KV: команда правит карточки одновременно, а KV на бесплатном плане даёт 1000 записей в сутки.

// Клиенты, которых крону раз в минуту надо проверить: открытый созвон или созвон без отчёта.
// Держим их id отдельно ("watch"), чтобы крон читал десяток строк, а не всю базу.
export const needsWatch = (c) =>
  (c.calls || []).some((x) => (!x.outcome && !x.legacy) || (x.outcome === "held" && !x.reportAt && !x.legacy && !x.notified?.report));

const SCHEMA = "CREATE TABLE IF NOT EXISTS docs (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated TEXT NOT NULL, PRIMARY KEY (kind, id))";

export function d1Store(db) {
  let ready = null;
  const init = () => (ready ||= db.prepare(SCHEMA).run());
  return {
    async all(kind) {
      await init();
      const { results } = await db.prepare("SELECT data FROM docs WHERE kind = ?").bind(kind).all();
      return results.map((r) => JSON.parse(r.data));
    },
    async recent(kind, limit = 100) {
      await init();
      const { results } = await db.prepare("SELECT data FROM docs WHERE kind = ? ORDER BY id DESC LIMIT ?").bind(kind, limit).all();
      return results.map((r) => JSON.parse(r.data));
    },
    async get(kind, id) {
      await init();
      const row = await db.prepare("SELECT data FROM docs WHERE kind = ? AND id = ?").bind(kind, String(id)).first();
      return row ? JSON.parse(row.data) : null;
    },
    async put(kind, id, data) {
      await init();
      await db
        .prepare("INSERT INTO docs (kind, id, data, updated) VALUES (?, ?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data, updated = excluded.updated")
        .bind(kind, String(id), JSON.stringify(data), new Date().toISOString())
        .run();
      if (kind === "client") await this.watch(id, needsWatch(data));
      return data;
    },
    async watch(id, on) {
      if (on) await db.prepare("INSERT OR IGNORE INTO docs (kind, id, data, updated) VALUES ('watch', ?, '{}', ?)").bind(String(id), new Date().toISOString()).run();
      else await db.prepare("DELETE FROM docs WHERE kind = 'watch' AND id = ?").bind(String(id)).run();
    },
    async watched() {
      await init();
      const { results } = await db.prepare("SELECT d.data FROM docs w JOIN docs d ON d.kind = 'client' AND d.id = w.id WHERE w.kind = 'watch'").all();
      return results.map((r) => JSON.parse(r.data));
    },
    async del(kind, id) {
      await init();
      await db.prepare("DELETE FROM docs WHERE kind = ? AND id = ?").bind(kind, String(id)).run();
      if (kind === "client") await this.watch(id, false);
    },
    async putMany(kind, items) {
      await init();
      const stmt = db.prepare(
        "INSERT INTO docs (kind, id, data, updated) VALUES (?, ?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data, updated = excluded.updated",
      );
      const now = new Date().toISOString();
      for (let i = 0; i < items.length; i += 50) {
        await db.batch(items.slice(i, i + 50).map((it) => stmt.bind(kind, String(it.id), JSON.stringify(it), now)));
      }
      if (kind === "client") for (const it of items) await this.watch(it.id, needsWatch(it));
    },
  };
}

export function memoryStore(seed = {}) {
  const data = new Map(Object.entries(seed).map(([k, v]) => [k, structuredClone(v)]));
  const key = (kind, id) => `${kind}/${id}`;
  return {
    data,
    async all(kind) {
      return [...data.entries()].filter(([k]) => k.startsWith(`${kind}/`)).map(([, v]) => structuredClone(v));
    },
    async recent(kind, limit = 100) {
      return [...data.entries()].filter(([k]) => k.startsWith(`${kind}/`)).sort(([a], [b]) => (a < b ? 1 : -1)).slice(0, limit).map(([, v]) => structuredClone(v));
    },
    async get(kind, id) {
      const v = data.get(key(kind, id));
      return v === undefined ? null : structuredClone(v);
    },
    async put(kind, id, value) {
      data.set(key(kind, id), structuredClone(value));
      return value;
    },
    async watched() {
      return [...data.entries()].filter(([k, v]) => k.startsWith("client/") && needsWatch(v)).map(([, v]) => structuredClone(v));
    },
    async del(kind, id) {
      data.delete(key(kind, id));
    },
    async putMany(kind, items) {
      for (const it of items) data.set(key(kind, it.id), structuredClone(it));
    },
  };
}
