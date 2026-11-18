import { expect, type Page, test } from '@playwright/test';
import { installBrowserHooks } from './browser-hooks';

installBrowserHooks();

async function createLink(page: Page) {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type('/link');
  const menu = page.locator('.menu-surface');
  await expect(menu.getByText('Link', { exact: true })).toBeVisible();
  await expect(menu.getByText('Normal Text', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Enter');
  await page
    .getByPlaceholder('https://example.com', { exact: true })
    .fill('https://example.com/original');
  await page
    .getByPlaceholder('Link text', { exact: true })
    .fill('Fixture link');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const link = body.getByRole('link', { name: 'Fixture link', exact: true });
  await expect(link).toHaveAttribute('href', 'https://example.com/original');
  await expect(body).toBeFocused();
  return { body, link };
}
async function openLinkEditor(page: Page, hasTouch: boolean) {
  const result = await createLink(page);
  if (hasTouch) await result.link.tap();
  else await result.link.click();
  await expect(
    page.getByPlaceholder('https://example.com', { exact: true })
  ).toHaveValue('https://example.com/original');
  return result;
}
test('link slash creation exports Markdown and restores saved JSON', async ({
  page,
}) => {
  const { body, link } = await createLink(page);
  await page.getByRole('button', { name: 'Save state', exact: true }).click();
  const saved = JSON.parse(
    (await page.locator('#saved').textContent()) ?? '{}'
  );
  expect(saved.markdown).toBe(
    '<m-link>{"url":"https://example.com/original","text":"Fixture link","title":""}</m-link>'
  );
  await page.getByRole('button', { name: 'Load image', exact: true }).click();
  await expect(link).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Reopen saved state', exact: true })
    .click();
  await expect(link).toHaveAttribute('href', 'https://example.com/original');
  await expect(body).toHaveText('Fixture link');
});
test('link editing changes a URL alone then changes URL and label through Enter', async ({
  page,
  hasTouch,
}) => {
  const { body, link } = await openLinkEditor(page, hasTouch);
  const url = page.getByPlaceholder('https://example.com', { exact: true });
  await url.fill('example.net/changed');
  await page.keyboard.press('Enter');
  await expect(link).toHaveAttribute('href', 'https://example.net/changed');
  await expect(link).toHaveText('Fixture link');
  if (hasTouch) await link.tap();
  else await link.click();
  await url.fill('https://example.org/final');
  await page
    .getByPlaceholder('Link text', { exact: true })
    .fill('Changed label');
  await page.keyboard.press('Enter');
  const changed = body.getByRole('link', {
    name: 'Changed label',
    exact: true,
  });
  await expect(changed).toHaveAttribute('href', 'https://example.org/final');
  await expect(body).toHaveText('Changed label');
  await expect(body).toBeFocused();
});
test('link removal preserves literal label through save and reopen', async ({
  page,
  hasTouch,
}) => {
  const { body } = await openLinkEditor(page, hasTouch);
  // Existing icon-only actions lack accessible names: open/edit/copy/remove.
  // This targets the real Remove control without claiming toolbar AX.
  const remove = page.locator('.menu-surface button').nth(3);
  if (hasTouch) await remove.tap();
  else await remove.click();
  await expect(body.getByRole('link')).toHaveCount(0);
  await expect(body).toHaveText('Fixture link');
  await expect(body).toBeFocused();
  await page.getByRole('button', { name: 'Save state', exact: true }).click();
  await page.getByRole('button', { name: 'Load image', exact: true }).click();
  await page
    .getByRole('button', { name: 'Reopen saved state', exact: true })
    .click();
  await expect(body.getByRole('link')).toHaveCount(0);
  await expect(body).toHaveText('Fixture link');
});
test('link Escape discards pending edits and returns focus to the body', async ({
  page,
  hasTouch,
}) => {
  const { body, link } = await openLinkEditor(page, hasTouch);
  await page
    .getByPlaceholder('https://example.com', { exact: true })
    .fill('https://example.net/discarded');
  await page
    .getByPlaceholder('Link text', { exact: true })
    .fill('Discarded label');
  await page.keyboard.press('Escape');
  await expect(
    page.getByPlaceholder('https://example.com', { exact: true })
  ).toHaveCount(0);
  await expect(link).toHaveAttribute('href', 'https://example.com/original');
  await expect(body).toHaveText('Fixture link');
  await expect(body).toBeFocused();
});
test('link copy replaces a clipboard sentinel with the actual URL', async ({
  page,
  context,
  hasTouch,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { link } = await createLink(page);
  await page.evaluate(() => navigator.clipboard.writeText('before link copy'));
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'before link copy'
  );
  if (hasTouch) await link.tap();
  else await link.click();
  const copy = page.locator('.menu-surface button').nth(2);
  if (hasTouch) await copy.tap();
  else await copy.click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('https://example.com/original');
  await page.keyboard.press('Escape');
  await expect(
    page.getByPlaceholder('https://example.com', { exact: true })
  ).toHaveCount(0);
});
test('link menu closes on read-only transition and resumes editing when unlocked', async ({
  page,
  hasTouch,
}) => {
  const { body, link } = await openLinkEditor(page, hasTouch);
  const before = await page.locator('#live-state').textContent();
  // Keyboard activation emits no outside pointerdown. Check that focus alone
  // leaves the menu open before exercising the editor's editability reset.
  const lock = page.getByRole('button', { name: 'Read only', exact: true });
  await lock.focus();
  await expect(
    page.getByPlaceholder('https://example.com', { exact: true })
  ).toHaveValue('https://example.com/original');
  await lock.press('Space');
  await expect(
    page.getByPlaceholder('https://example.com', { exact: true })
  ).toHaveCount(0);
  await expect(body).toHaveAttribute('aria-readonly', 'true');
  expect(await page.locator('#live-state').textContent()).toBe(before);
  await page.getByRole('button', { name: 'Editable', exact: true }).click();
  if (hasTouch) await link.tap();
  else await link.click();
  await expect(
    page.getByPlaceholder('https://example.com', { exact: true })
  ).toHaveValue('https://example.com/original');
  await page.keyboard.press('Escape');
  await expect(
    page.getByPlaceholder('https://example.com', { exact: true })
  ).toHaveCount(0);
});
test('link hover preview follows the desktop pointer and stays absent on touch', async ({
  page,
  hasTouch,
}) => {
  const { link } = await createLink(page);
  await link.hover();
  const preview = page.locator('.menu-surface');
  if (hasTouch) {
    await expect(preview).toHaveCount(0);
  } else {
    await expect(preview).toContainText('Fixture link');
    await expect(preview).toContainText('example.com');
    await page.getByRole('textbox', { name: 'Title', exact: true }).hover();
    await expect(preview).toHaveCount(0);
  }
});
