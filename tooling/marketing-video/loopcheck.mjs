// Checks a looping scene: frame 0 and the loop point (t = DURATION) must match, and a frame must not depend on the
// frames seeked before it (purity). Prints the largest channel difference and how many pixels differ by more than 8.
//   PAGE=ui.html FMT=45 QS="&ad=pr" node loopcheck.mjs
let chromium; // local `npm i playwright`, else the global install in this container
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs")); }
import path from "node:path";
const [VW, VH] = { "916": [1080, 1920], "45": [1080, 1350], "11": [1440, 1440] }[process.env.FMT || "11"];
const b = await chromium.launch({ args: ["--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text"] });
const ctx = await b.newContext({ viewport: { width: VW, height: VH } });
const p = await ctx.newPage();
await p.goto("file://" + path.resolve(process.env.PAGE || "ui.html") + "?render=1&fmt=" + (process.env.FMT || "11") + (process.env.QS || ""));
await p.evaluate(() => window.ready);
// a PNG of the frame at t; frames are compared inside the page so only two numbers come back
const grab = async (t) => { await p.evaluate((tt) => window.seek(tt), t); return (await p.screenshot({ type: "png" })).toString("base64"); };
const cmp = (x, y) => p.evaluate(async ([x, y]) => {
  const px = async (b64) => { const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode(); const c = new OffscreenCanvas(img.width, img.height), g = c.getContext("2d"); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data; };
  const A = await px(x), B = await px(y); let mx = 0, n = 0;
  for (let i = 0; i < A.length; i += 4) { const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])); if (d > mx) mx = d; if (d > 8) n++; }
  return [mx, n];
}, [x, y]);
const T = await p.evaluate(() => window.DURATION);
const f0 = await grab(0), fT = await grab(T);
const m1 = await grab(7.31); await grab(12.2); await grab(2.1); const m2 = await grab(7.31);
const [a, an] = await cmp(f0, fT), [c, cn] = await cmp(m1, m2);
console.log(`${process.env.QS || ""} ${process.env.FMT || "11"}: loop max ${a} (${an} px > 8) · purity max ${c} (${cn} px > 8)`);
await b.close();
if (an > 0 || cn > 0) process.exitCode = 1;
