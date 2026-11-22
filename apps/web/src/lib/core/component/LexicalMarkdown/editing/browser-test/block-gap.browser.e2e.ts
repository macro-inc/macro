import { expect, type Page, test } from '@playwright/test';
import { z } from 'zod';

const STATE = z.object({
  root: z.object({ children: z.array(z.object({ type: z.string() })) }),
});
async function types(page: Page) {
  return STATE.parse(
    JSON.parse((await page.locator('#live-state').textContent()) ?? '{}')
  ).root.children.map((node) => node.type);
}
async function load(page: Page) {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await page
    .getByRole('button', { name: 'Load block gap', exact: true })
    .click();
  await expect
    .poll(() => types(page))
    .toEqual(['custom-code', 'custom-code', 'paragraph']);
}
async function gap(page: Page) {
  return page.locator('#body').evaluate((root) => {
    const before = root.children[0].getBoundingClientRect(),
      after = root.children[1].getBoundingClientRect(),
      bounds = root.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2,
      y = (before.bottom + after.top) / 2;
    return {
      x,
      y,
      height: after.top - before.bottom,
      rootHit: document.elementFromPoint(x, y) === root,
    };
  });
}
test('installed native block-gap pointer action inserts one typing paragraph and preserves both code blocks', async ({
  page,
}, info) => {
  await load(page);
  const point = await gap(page);
  expect(point.height).toBeGreaterThan(0);
  expect(point.rootHit).toBe(true);
  if (info.project.use.hasTouch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect
    .poll(() => types(page))
    .toEqual(['custom-code', 'paragraph', 'custom-code', 'paragraph']);
  await expect(page.locator('#body')).toBeFocused();
  await page.keyboard.type('Between blocks');
  await expect(page.locator('#body > p').first()).toHaveText('Between blocks');
  await expect(page.locator('#body')).toContainText('const first = 1;');
  await expect(page.locator('#body')).toContainText('const second = 2;');
});
test('native gap creation is one exact undo and redo step', async ({
  page,
}, info) => {
  await load(page);
  const before = await page.locator('#live-state').textContent(),
    point = await gap(page);
  expect(point.height).toBeGreaterThan(0);
  if (info.project.use.hasTouch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect
    .poll(() => types(page))
    .toEqual(['custom-code', 'paragraph', 'custom-code', 'paragraph']);
  const after = await page.locator('#live-state').textContent();
  await page.keyboard.press('Control+z');
  await expect(page.locator('#live-state')).toHaveText(before ?? '');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('#live-state')).toHaveText(after ?? '');
});
test('readonly gap input leaves native bytes unchanged', async ({
  page,
}, info) => {
  await load(page);
  await page.getByRole('button', { name: 'Read only', exact: true }).click();
  const before = await page.locator('#live-state').textContent(),
    point = await gap(page);
  if (info.project.use.hasTouch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  expect(await page.locator('#live-state').textContent()).toBe(before);
});

for (const effect of ['none', 'dispose', 'readonly']) {
  test(`queued gap waits for actual completion and rechecks ${effect} before focus`, async ({
    page,
  }) => {
    await load(page);
    const name = effect === 'none' ? 'Queue gap' : `Queue gap then ${effect}`;
    await page.getByRole('button', { name, exact: true }).click();
    await expect
      .poll(() => types(page))
      .toEqual(['custom-code', 'paragraph', 'custom-code', 'paragraph']);
    await expect(page.locator('#queued')).toHaveText(
      JSON.stringify({ duringCalls: 0, afterCalls: effect === 'none' ? 1 : 0 })
    );
  });
}
