// Render the trailer with Playwright.
//   node render.mjs stills <outDir> <beat> [<beat> ...]   one PNG per beat position
//   node render.mjs frames <outDir> [workers]             60 fps x 4 subframes (for tmix)
//   node render.mjs cues <out.json>                       export sound cues
let chromium; // local `npm i playwright`, else the global install in this container
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs")); }
import fs from "node:fs";
import path from "node:path";

const HTML = "file://" + path.resolve("trailer.html") + "?render=1";
const FPS = 60, SUB = 4, SHUTTER = 0.5; // 180° shutter, 4 samples per frame

async function openPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1440 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.error("console:", m.text()); });
  await page.goto(HTML);
  await page.evaluate(() => window.ready);
  const cdp = await ctx.newCDPSession(page);
  return { page, cdp };
}

async function shot(p, t, file) {
  await p.page.evaluate((tt) => window.seek(tt), t);
  const { data } = await p.cdp.send("Page.captureScreenshot", {
    format: "png", clip: { x: 0, y: 0, width: 1440, height: 1440, scale: 1 }, optimizeForSpeed: true,
  });
  fs.writeFileSync(file, Buffer.from(data, "base64"));
}

const [, , mode, out, ...rest] = process.argv;
const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text"] });
try {
  if (mode === "cues") {
    const p = await openPage(browser);
    const cues = await p.page.evaluate(() => ({ duration: window.DURATION, music: window.MUSIC, cues: window.CUES }));
    fs.writeFileSync(out, JSON.stringify(cues, null, 1));
    console.log("cues:", cues.cues.length);
  } else if (mode === "stills") {
    fs.mkdirSync(out, { recursive: true });
    const p = await openPage(browser);
        for (const b of rest) {
      const t = await p.page.evaluate((x) => window.B(x), parseFloat(b));
      await shot(p, t, path.join(out, `b${parseFloat(b).toFixed(2).padStart(5, "0")}.png`));
    }
    console.log("stills:", rest.length);
  } else if (mode === "frames") {
    fs.mkdirSync(out, { recursive: true });
    const workers = parseInt(rest[0] || "4", 10);
    const probe = await openPage(browser);
    const dur = await probe.page.evaluate(() => window.DURATION);
    await probe.page.context().close();
    const frames = Math.round(dur * FPS);
    const total = frames * SUB;
    const jobs = [];
    const t0 = Date.now();
    let done = 0;
    for (let w = 0; w < workers; w++) {
      jobs.push((async () => {
        const p = await openPage(browser);
        const a = Math.floor((w * frames) / workers), b = Math.floor(((w + 1) * frames) / workers);
        for (let f = a; f < b; f++) {
          for (let k = 0; k < SUB; k++) {
            const t = f / FPS + ((k - (SUB - 1) / 2) * (SHUTTER / FPS)) / SUB;
            await shot(p, t, path.join(out, `${String(f * SUB + k).padStart(5, "0")}.png`));
            done++;
          }
          if (w === 0 && f % 20 === 0) {
            const el = (Date.now() - t0) / 1000;
            console.log(`${done}/${total}  ${el.toFixed(0)}s  eta ${((el / done) * (total - done)).toFixed(0)}s`);
          }
        }
      })());
    }
    await Promise.all(jobs);
    console.log("frames:", total, "in", ((Date.now() - t0) / 1000).toFixed(0), "s");
  }
} finally {
  await browser.close();
}
