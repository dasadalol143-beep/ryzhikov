import { continueRender, delayRender, staticFile } from "remotion";

const faces: [string, string, string][] = [
  ["Unbounded", "fonts/Unbounded.ttf", "200 900"],
  ["Montserrat", "fonts/Montserrat.ttf", "100 900"],
  ["Inter", "fonts/Inter.ttf", "100 900"],
];

let loaded = false;
export const loadFonts = () => {
  if (loaded || typeof document === "undefined") return;
  loaded = true;
  const handle = delayRender("fonts");
  Promise.all(
    faces.map(([family, file, weight]) => {
      const f = new FontFace(family, `url(${staticFile(file)})`, { weight });
      document.fonts.add(f);
      return f.load();
    }),
  )
    .then(() => continueRender(handle))
    .catch((e) => {
      console.error(e);
      continueRender(handle);
    });
};
