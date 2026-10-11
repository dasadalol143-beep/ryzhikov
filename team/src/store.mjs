// Хранилище документов: kind + id → JSON. На Cloudflare это D1 (SQLite), в тестах — память.
// D1 вместо KV: команда правит карточки одновременно, а KV на бесплатном плане даёт 1000 записей в сутки.

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
      return data;
    },
    async del(kind, id) {
      await init();
      await db.prepare("DELETE FROM docs WHERE kind = ? AND id = ?").bind(kind, String(id)).run();
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
    async get(kind, id) {
      const v = data.get(key(kind, id));
      return v === undefined ? null : structuredClone(v);
    },
    async put(kind, id, value) {
      data.set(key(kind, id), structuredClone(value));
      return value;
    },
    async del(kind, id) {
      data.delete(key(kind, id));
    },
    async putMany(kind, items) {
      for (const it of items) data.set(key(kind, it.id), structuredClone(it));
    },
  };
}
