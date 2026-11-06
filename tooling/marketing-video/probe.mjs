let chromium; // local `npm i playwright`, else the global install in this container
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs")); }
import fs from "node:fs"; import path from "node:path";
const page = process.env.PAGE || "trailer.html";
const fmt = process.env.FMT ? "&fmt=" + process.env.FMT : "";
const b = await chromium.launch(); const p = await b.newPage();
await p.goto("file://" + path.resolve(page) + "?render=1" + fmt); await p.evaluate(() => window.ready);
const rows = await p.evaluate(() => { const out = []; const N = Math.round(window.DURATION * 480); for (let i = 0; i <= N; i++) out.push(window.probe(i / 480)); return out; });
fs.mkdirSync("stills", { recursive: true });
fs.writeFileSync("stills/probe.json", JSON.stringify(rows));
const same = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
console.log(rows.length, "seam", same(rows[0], rows[rows.length - 1]));
await b.close();
