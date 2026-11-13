import { expect, type Page, test } from '@playwright/test';

test.setTimeout(60_000);

const FIRST = 'now a long poem about birds';

/**
 * How many visible leaf elements read exactly as the prompt — must be one.
 * The static preview's screen-reader copy is not on screen and is skipped.
 */
function visibleCopies(page: Page, text: string) {
  return page.evaluate(
    (expected) =>
      Array.from(document.body.querySelectorAll('*')).filter(
        (element) =>
          element.children.length === 0 &&
          element.textContent?.trim() === expected &&
          !element.classList.contains('sr-only') &&
          element.checkVisibility()
      ).length,
    text
  );
}

const queue = (page: Page) => page.getByTestId('agent-queued-prompts');
const composer = (page: Page) =>
  page.locator('[contenteditable="true"]').last();
const log = (page: Page) => page.getByTestId('fixture-log');

for (const count of [1, 3]) {
  test(`opening a queued message shows its text once (${count} queued)`, async ({
    page,
  }) => {
    await page.goto(`/queued.html?count=${count}`);
    await expect(queue(page).getByRole('button', { name: FIRST })).toBeVisible({
      timeout: 30_000,
    });
    await expect.poll(() => visibleCopies(page, FIRST)).toBe(1);

    await queue(page).getByRole('button', { name: FIRST }).click();
    const editor = queue(page).locator('[contenteditable="true"]:visible');
    await expect(editor).toBeVisible();
    await expect(editor).toHaveText(FIRST);
    await expect(queue(page).getByRole('button', { name: FIRST })).toBeHidden();
    await expect.poll(() => visibleCopies(page, FIRST)).toBe(1);
    // Every row keeps its own Queued label, Steer, and remove control.
    await expect(queue(page).getByText('Queued', { exact: true })).toHaveCount(
      count
    );
    await expect(
      queue(page).getByRole('button', { name: 'Steer' })
    ).toHaveCount(count);
    await expect(
      queue(page).getByRole('button', { name: 'Remove queued message' })
    ).toHaveCount(count);
  });
}

test('Up edits the next-to-send message; Enter saves, Escape restores, focus returns', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Enter is a newline on a virtual keyboard');
  await page.goto('/queued.html?count=3');
  await expect(queue(page).getByRole('button', { name: FIRST })).toBeVisible({
    timeout: 30_000,
  });
  await composer(page).click();

  await page.keyboard.press('ArrowUp');
  const editor = queue(page).locator('[contenteditable="true"]:visible');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText(FIRST);

  // Shift+Enter is a newline; Enter saves and closes.
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('and one about bees');
  await expect(log(page)).toHaveText('');
  await page.keyboard.press('Enter');
  await expect(log(page)).toHaveText(
    `edit queued-1: ${FIRST}\nand one about bees`
  );
  await expect(composer(page)).toBeFocused();
  await expect(editor).toBeHidden();
  await expect(
    queue(page).getByRole('button', { name: /now a long poem about birds/ })
  ).toBeVisible();

  // Escape throws the typing away and shows the saved text again.
  await page.keyboard.press('ArrowUp');
  await expect(editor).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type(' DISCARDED');
  await page.keyboard.press('Escape');
  await expect(composer(page)).toBeFocused();
  await expect(editor).toBeHidden();
  await expect(queue(page)).not.toContainText('DISCARDED');
  await expect(log(page).locator('li')).toHaveCount(1);

  // Opening and closing an untouched row is not an edit, even for the link
  // row, whose markdown the editor writes out with different markup.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(editor).toContainText('the field guide');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await composer(page).click();
  await expect(log(page).locator('li')).toHaveCount(1);
  // Clicking away also closed the row.
  await expect(editor).toBeHidden();
});

test('Escape closes an open editor menu before it closes the row', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Keyboard-only');
  await page.goto('/queued.html?count=3');
  await expect(queue(page).getByRole('button', { name: FIRST })).toBeVisible({
    timeout: 30_000,
  });
  await composer(page).click();
  await page.keyboard.press('ArrowUp');
  const editor = queue(page).locator('[contenteditable="true"]:visible');
  await expect(editor).toBeFocused();

  // The emoji menu takes the first Escape; the typing stays.
  await page.keyboard.press('End');
  await page.keyboard.type(' :bir');
  await expect(page.locator('.menu-surface')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-surface')).toBeHidden();
  await expect(editor).toBeVisible();
  await expect(editor).toContainText(':bir');
  await expect(log(page)).toHaveText('');

  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();

  // The link popup takes the first Escape too, and keeps the typing.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(editor).toContainText('the field guide');
  await page.keyboard.press('End');
  await page.keyboard.type(' kept');
  await editor.getByText('the field guide').click();
  await expect(page.locator('.menu-surface')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-surface')).toBeHidden();
  await expect(editor).toBeVisible();
  await expect(editor).toContainText('kept');
  // Escape from inside the popup's URL field closes only the popup. Focus
  // moving into the field saved the text, as leaving the editor always does.
  await editor.getByText('the field guide').click();
  // The popup's second button is Edit link (icon-only).
  await page.locator('.menu-surface button').nth(1).click();
  await expect(page.locator('.menu-surface input').first()).toBeFocused();
  await expect(log(page).locator('li')).toHaveCount(1);
  await expect(log(page)).toContainText('kept');
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-surface')).toBeHidden();
  await expect(editor).toBeVisible();
  await expect(editor).toContainText('kept');
  await editor.click();
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await expect(composer(page)).toBeFocused();
  await expect(log(page).locator('li')).toHaveCount(1);
});

test('tapping a queued message edits it in place and saves on leaving', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'The touch variant of the composer');
  await page.goto('/queued.html?count=3');
  await expect(queue(page).getByRole('button', { name: FIRST })).toBeVisible({
    timeout: 30_000,
  });
  await queue(page).getByRole('button', { name: FIRST }).click();
  const editor = queue(page).locator('[contenteditable="true"]:visible');
  await expect(editor).toBeFocused();
  await expect.poll(() => visibleCopies(page, FIRST)).toBe(1);
  await page.keyboard.press('End');
  await page.keyboard.type(' please');
  await composer(page).click();
  await expect(log(page)).toHaveText(`edit queued-1: ${FIRST} please`);
  // Tapping away closed the row; the preview shows the saved text.
  await expect(editor).toBeHidden();
  await expect(
    queue(page).getByRole('button', { name: `${FIRST} please` })
  ).toBeVisible();
});
