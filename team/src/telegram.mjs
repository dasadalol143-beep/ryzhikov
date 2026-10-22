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
    sendChatAction: (chatId, action = "typing") => call("sendChatAction", form({ chat_id: chatId, action })),
    getMe: () => call("getMe", form({})),
    getChatMember: (chatId, userId) => call("getChatMember", form({ chat_id: chatId, user_id: userId })),
    copyMessage: (chatId, fromChatId, messageId, opts = {}) => call("copyMessage", form({ chat_id: chatId, from_chat_id: fromChatId, message_id: messageId, ...opts })),
    // Файл уже лежит в Telegram — шлём по file_id, без скачивания (размер не ограничен 20 МБ).
    sendFileById: (kind, chatId, fileId, caption, opts = {}) => {
      const method = { video: "sendVideo", audio: "sendAudio", voice: "sendVoice", video_note: "sendVideoNote" }[kind] || "sendDocument";
      const field = { video: "video", audio: "audio", voice: "voice", video_note: "video_note" }[kind] || "document";
      return call(method, form({ chat_id: chatId, [field]: fileId, caption: kind === "video_note" ? undefined : caption, parse_mode: "HTML", ...opts }));
    },
    // Загрузка файла из приложения (Bot API принимает до 50 МБ).
    uploadDocument: (chatId, file, caption, opts = {}, filename = undefined) => {
      const fd = form({ chat_id: chatId, caption, parse_mode: "HTML", ...opts });
      fd.append("document", file, filename || file.name || "file");
      return call("sendDocument", fd);
    },
    downloadFile: async (fileId) => {
      const f = await call("getFile", form({ file_id: fileId }));
      const res = await fetchImpl(`https://api.telegram.org/file/bot${botToken}/${f.file_path}`);
      if (!res.ok) throw new Error("telegram file download failed");
      return res.arrayBuffer();
    },
  };
}

export const escapeHtml = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

// Секрет вебхука выводим из токена бота: отдельный секрет хранить не нужно.
export async function webhookSecret(botToken) {
  const data = new TextEncoder().encode(`webhook:${botToken}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}
