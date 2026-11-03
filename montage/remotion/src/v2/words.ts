// Привязка графики к словам: ищем слово в таймлайне рядом с примерным временем (сдвиги монтажа не ломают привязку)
export type TW = { w: string; s: number; e: number; seg: number };
const norm = (x: string) => x.toLowerCase().replace(/[«»"“”.,!?…:;—-]/g, "").replace(/ё/g, "е");

export const makeWT = (words: TW[]) => {
  const wt = (text: string, near: number, field: "s" | "e" = "s"): number => {
    const n = norm(text);
    let best: TW | null = null;
    for (const w of words) {
      if (!norm(w.w).startsWith(n)) continue;
      if (!best || Math.abs(w.s - near) < Math.abs(best.s - near)) best = w;
    }
    if (!best || Math.abs(best.s - near) > 4) throw new Error(`слово «${text}» около ${near} c не найдено`);
    return best[field];
  };
  return wt;
};
