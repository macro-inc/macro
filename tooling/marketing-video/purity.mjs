let chromium; // local `npm i playwright`, else the global install in this container
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs")); }
import path from "node:path"; import crypto from "node:crypto";
const b = await chromium.launch({ args: ["--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text"] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1440 } }); const p = await ctx.newPage();
await p.goto("file://" + path.resolve("trailer.html") + "?render=1"); await p.evaluate(() => window.ready);
const cdp = await ctx.newCDPSession(p);
const snap = async (t) => { await p.evaluate((tt) => window.seek(tt), t); const { data } = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true }); return crypto.createHash("md5").update(data).digest("hex"); };
const T = await p.evaluate(() => window.DURATION);
const a = await snap(0); await snap(7.3); await snap(10.1); const b2 = await snap(0); const c = await snap(T); const d = await snap(T * 2 + 0);
console.log("t=0 fresh", a, "\nt=0 after others", b2, "\nt=T", c, "\nt=2T", d);
const e = await snap(9.04); await snap(3); const f = await snap(9.04); console.log("t=9.04 twice equal:", e === f);
await b.close();
