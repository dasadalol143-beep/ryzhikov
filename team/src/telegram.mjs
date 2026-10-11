// Минимальный клиент Bot API: сообщения и файлы в личку.
export function telegram(botToken, fetchImpl = fetch) {
  const call = async (method, body) => {
    const res = await fetchImpl(`https://api.telegram.org/bot${botToken}/${method}`, { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(data.description || `telegram ${method} failed`);
    return data.result;
  };
  const form = (fields) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, typeof v === "object" && !(v instanceof Blob) ? JSON.stringify(v) : v);
    return fd;
  };
  return {
    sendMessage: (chatId, text, replyMarkup) =>
      call("sendMessage", form({ chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: replyMarkup })),
    setWebhook: (url, secretToken) => call("setWebhook", form({ url, secret_token: secretToken, allowed_updates: ["message", "callback_query"], drop_pending_updates: "true" })),
    answerCallback: (id, text) => call("answerCallbackQuery", form({ callback_query_id: id, text })),
    editMessage: (chatId, messageId, text, replyMarkup) =>
      call("editMessageText", form({ chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: replyMarkup })),
    setMyCommands: (commands) => call("setMyCommands", form({ commands })),
    sendDocument: (chatId, filename, content, mime, caption) =>
      call("sendDocument", form({ chat_id: chatId, caption, document: new File([content], filename, { type: mime }) })),
  };
}

export const escapeHtml = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

// Секрет вебхука выводим из токена бота: отдельный секрет хранить не нужно.
export async function webhookSecret(botToken) {
  const data = new TextEncoder().encode(`webhook:${botToken}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}
