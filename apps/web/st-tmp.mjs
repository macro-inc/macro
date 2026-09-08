import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 791, height: 1014 } });

const jumped = () => page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll('*')) {
    if (el.scrollTop > 0) {
      const o = getComputedStyle(el).overflowY;
      if (o === 'hidden' || o === 'clip') bad.push(`${(el.className||'').toString().slice(0,44)} top=${Math.round(el.scrollTop)}`);
    }
  }
  return bad;
});

// Every focusable control across the pages that have them.
for (const [slug, sel] of [
  ['toggle-switch', '[id$="-control"]'],
  ['checkbox', 'input[type=checkbox]'],
  ['button', 'button'],
  ['select', '[id$="-trigger"], button'],
]) {
  await page.goto(`http://localhost:3004/app/component/ui?ui=${slug}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('article', { timeout: 30000 });
  const items = page.locator(sel);
  const n = Math.min(await items.count(), 6);
  for (let i = 0; i < n; i++) {
    try {
      await items.nth(i).scrollIntoViewIfNeeded();
      await items.nth(i).click({ timeout: 3000 });
      await page.waitForTimeout(120);
    } catch {}
  }
  const bad = await jumped();
  console.log(`${slug.padEnd(14)} clicked ${n} controls -> ${bad.length ? 'JUMPED: ' + bad.join(' | ') : 'no unscrollable container moved'}`);
}

// Keyboard tabbing is the other way focus lands off-screen.
await page.goto('http://localhost:3004/app/component/ui?ui=toggle-switch', { waitUntil: 'networkidle' });
await page.waitForSelector('article');
for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
await page.waitForTimeout(400);
const bad = await jumped();
console.log(`25x Tab       -> ${bad.length ? 'JUMPED: ' + bad.join(' | ') : 'no unscrollable container moved'}`);
await browser.close();
