import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_AGE_SECONDS = 24 * 60 * 60;

// Проверка initData по алгоритму Telegram:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
export function verifyInitData(initData, botToken, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!authDate || nowSeconds - authDate > MAX_AGE_SECONDS) return null;

  try {
    const user = JSON.parse(params.get("user") || "null");
    return user && user.id ? user : null;
  } catch {
    return null;
  }
}

export function parseIds(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number),
  );
}

export function roleFor(userId, env) {
  if (parseIds(env.ADMIN_IDS).has(userId)) return "admin";
  if (parseIds(env.MANAGER_IDS).has(userId)) return "manager";
  return null;
}
