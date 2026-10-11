import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_AGE_SECONDS = 24 * 60 * 60;

// Проверка initData по алгоритму Telegram:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
export function verifyInitData(initData, botToken, nowSeconds) {
  return checkInitData(initData, botToken, nowSeconds).user;
}

// То же, но с причиной отказа — её видно на экране «нет входа».
export function checkInitData(initData, botToken, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!botToken) return { user: null, reason: "no_bot_token" };
  if (!initData) return { user: null, reason: "no_init_data" };
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { user: null, reason: "no_hash" };
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { user: null, reason: "bad_signature" };

  const authDate = Number(params.get("auth_date"));
  if (!authDate || nowSeconds - authDate > MAX_AGE_SECONDS) return { user: null, reason: "expired" };

  try {
    const user = JSON.parse(params.get("user") || "null");
    return user && user.id ? { user, reason: null } : { user: null, reason: "no_user" };
  } catch {
    return { user: null, reason: "no_user" };
  }
}

export function parseIds(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}
