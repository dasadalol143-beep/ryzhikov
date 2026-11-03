// Орфография и склейка слов для субтитров (Whisper ошибается в нишевых словах и рвёт дефисы)
export type TW = { w: string; s: number; e: number; seg?: number };

const FIX: [RegExp, string][] = [
  [/^зафоршенн/i, "зафорсенн"],
  [/^банке([.,]?)$/i, "банки$1"],
  [/^«?Литгид»?/i, "LeadGid"],
  [/^«?ФЦН»?/i, "FCN"],
  [/^Четвертый/i, "Четвёртый"],
  [/^партнерск/i, "партнёрск"],
  [/^все$/i, "всё"],
  [/^ее$/i, "её"],
];

export const fixWord = (w: string) => {
  let x = w;
  for (const [re, rep] of FIX) x = x.replace(re, rep);
  return x;
};

/** Склеивает «какие -либо» → «какие-либо», выкидывает тире, кавычки названий держит одним словом. */
export const cleanWords = (words: TW[]): TW[] => {
  const ws: TW[] = [];
  for (const w of words) {
    if (w.w === "—" || w.w === "-") continue;
    if (w.w.startsWith("-") && ws.length) { const p = ws[ws.length - 1]; ws[ws.length - 1] = { ...p, w: p.w + w.w, e: w.e }; continue; }
    ws.push({ ...w, w: fixWord(w.w) });
  }
  for (let i = 0; i < ws.length; i++) {
    if (ws[i].w.startsWith("«") && !ws[i].w.includes("»")) {
      let j = i; while (j + 1 < ws.length && !ws[j].w.includes("»")) j++;
      ws.splice(i, j - i + 1, { ...ws[i], w: ws.slice(i, j + 1).map((x) => x.w).join(" "), e: ws[j].e });
    }
    ws[i].w = ws[i].w.replace(/[«»]/g, "");
  }
  return ws;
};
