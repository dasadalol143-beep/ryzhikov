import { getStore } from "@netlify/blobs";
import { createHandler } from "../../lib/core.mjs";

function blobStore() {
  const store = getStore({ name: "rko-crm", consistency: "strong" });
  return {
    getJSON: (key) => store.get(key, { type: "json" }),
    setJSON: (key, value) => store.setJSON(key, value),
    delete: (key) => store.delete(key),
    list: async (prefix) => (await store.list({ prefix })).blobs.map((b) => b.key),
  };
}

export default async (req) => createHandler({ store: blobStore(), env: process.env })(req);

export const config = { path: "/api/*" };
