let chromium; // local `npm i playwright`, else the global install in this container
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs")); }
import fs from "node:fs"; import path from "node:path";
const b = await chromium.launch(); const p = await b.newPage();
await p.goto("file://" + path.resolve("trailer.html") + "?render=1"); await p.evaluate(() => window.ready);
const rows = await p.evaluate(() => { const out = []; const N = Math.round(window.DURATION * 480); for (let i = 0; i <= N; i++) out.push(window.probe(i / 480)); return out; });
fs.writeFileSync("stills/probe.json", JSON.stringify(rows)); console.log(rows.length); await b.close();
