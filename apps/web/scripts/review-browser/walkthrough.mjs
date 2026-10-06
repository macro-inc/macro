import { lab, assert } from './lab.mjs';

// The small mixed-language fixture has two tour sections and both diff sides.
const h = await lab(Number(process.argv[2] || 7121));
try {
  const { root, page } = h;
  page.setDefaultTimeout(15000);
  const { review } = await h.api('/review');
  const [first, second] = review.tour;
  assert(first && second, 'Fixture needs two walkthrough sections');
  await h.open();
  await page.bringToFront();
  await root.getByRole('button', { name: 'Review changes', exact: true }).click();
  const nav = root.getByRole('complementary', { name: 'Review navigation', exact: true });
  const reader = root.locator('[data-review-scroll]');
  await reader.locator('[data-review-row]').first().waitFor({ timeout: 60000 });
  const section = (index) => nav.locator(`[data-review-chapter="chapter:${index}"]`);
  assert(await nav.locator('[data-review-chapter-description="0"]').innerText() === first.description,
    'First explanation missing from sidebar');
  assert(await nav.locator('[data-review-chapter-description="1"]').innerText() === second.description,
    'Second explanation missing from sidebar');
  assert(await section(0).getAttribute('aria-expanded') === 'false', 'Tour trees must start closed');
  console.log(JSON.stringify({ stage: 'sidebar-explanations' }));

  const bounds = await reader.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .6, bounds.y + bounds.height * .7);
  for (let step = 0; step < 50 && await section(1).getAttribute('aria-current') !== 'step'; step++) {
    await page.mouse.wheel(0, 150);
    await page.waitForTimeout(70);
  }
  assert(await section(1).getAttribute('aria-current') === 'step', 'Wheel scrolling did not enter the second section');
  assert(await section(1).getAttribute('aria-expanded') === 'true', 'Entering a section did not expand its tree');
  await section(1).click();
  const before = await reader.evaluate(el => el.scrollTop);
  assert(await section(1).getAttribute('aria-expanded') === 'false', 'Manual collapse failed');
  await page.mouse.move(bounds.x + bounds.width * .6, bounds.y + bounds.height * .7);
  await page.mouse.wheel(0, 30);
  await page.waitForTimeout(200);
  assert(await section(1).getAttribute('aria-expanded') === 'false', 'Scrolling within the section reopened a manual collapse');
  assert((await reader.evaluate(el => el.scrollTop)) >= before, 'Sidebar collapse moved the code');
  await section(0).click();
  await section(1).click();
  assert(await section(1).getAttribute('aria-expanded') === 'true', 'Returning to a section did not expand it');
  await nav.getByRole('button', { name: 'Collapse all', exact: true }).click();
  assert(await nav.locator('[data-review-chapter][aria-expanded="true"]').count() === 0,
    'Collapse all did not override automatic expansion');
  console.log(JSON.stringify({ stage: 'scroll-expansion' }));

  // Select a real range by dragging over the source, then use the floating action.
  await section(0).click();
  const file = root.locator(`[data-review-file="${first.focus.path}"]`);
  const line = (n, side = first.focus.side) => file.locator(`[data-review-side="${side}"][data-review-line="${n}"]`);
  await line(first.focus.line).waitFor();
  const a = await line(first.focus.line).locator('code').boundingBox();
  const b = await line(first.focus.line + 2).locator('code').boundingBox();
  await page.mouse.move(a.x + 70, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 90, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  const ask = root.getByRole('button', { name: 'Ask agent', exact: true });
  await ask.waitFor();
  assert(await file.locator('[data-selected]').count() === 3, 'Drag did not select the complete range');
  const chip = await ask.boundingBox();
  assert(Math.abs(chip.y - a.y) < 90, 'Ask agent is detached from the selected source');
  assert(await root.getByRole('button', { name: /Copy link to|Clear selection/ }).count() === 0,
    'Selection still has extra actions');
  await page.screenshot({ path: '/tmp/macro-review-public/walkthrough-selection.png' });
  await page.keyboard.press('Escape');
  assert(await ask.count() === 0 && await file.locator('[data-selected]').count() === 0,
    'Escape did not clear the selection');
  assert(await reader.isVisible(), 'Escape left the review');
  await line(first.focus.line).getByRole('button').click();
  await ask.click();
  const composer = root.getByRole('textbox', { name: 'Comment on this code', exact: true });
  await composer.waitFor();
  await composer.fill('Explain this selected code.');
  await root.getByRole('button', { name: 'Comment', exact: true }).click();
  await composer.waitFor({ state: 'hidden' });
  assert(h.writes.at(-1).location.line === first.focus.line, 'Question targeted the wrong line');
  assert(h.writes.at(-1).location.side === first.focus.side, 'Question targeted the wrong side');

  await page.setViewportSize({ width: 390, height: 844 });
  await root.getByRole('button', { name: 'Review navigation', exact: true }).click();
  await nav.locator('[data-review-chapter-description="0"]').waitFor();
  await root.getByRole('button', { name: 'Close review navigation', exact: true }).click();
  await line(first.focus.line).getByRole('button').click();
  await ask.waitFor();
  const mobile = await ask.boundingBox();
  assert(mobile.x >= 0 && mobile.x + mobile.width <= 390, 'Mobile chip escaped viewport');
  await ask.click();
  await composer.waitFor();
  await composer.press('Escape');
  assert(await reader.isVisible(), 'Cancelling the question closed the review');
  assert(h.errors.length === 0, h.errors.join('; '));
  console.log(JSON.stringify({ pass: true, checks: [
    'inline sidebar explanations', 'scroll-driven section expansion', 'manual collapse and collapse all',
    'drag selection and nearby Ask agent', 'Escape clears selection', 'question preserves source location',
    'mobile sidebar and selection action'
  ] }));
} catch (error) {
  await h.page.screenshot({ path: '/tmp/macro-review-public/walkthrough-failure.png' }).catch(() => {});
  throw error;
} finally {
  await h.context.close();
}
process.exit(0);
