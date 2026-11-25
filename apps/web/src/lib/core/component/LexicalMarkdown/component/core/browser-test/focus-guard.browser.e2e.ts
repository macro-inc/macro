import { expect, type Locator, type Page, test } from '@playwright/test';

/**
 * An editor writes its caret into the page only where focus can go: never
 * while someone types in another field (an input, a textarea, another
 * editor), unless `editor.focus()` asks. Buttons, menus and prompts that
 * change the document's selection still move the caret into it.
 */

// Desktop toolbar and menu flows; the guard itself does not depend on input.
test.skip(({ hasTouch }) => hasTouch, 'desktop toolbar flows');

async function open(page: Page) {
  await page.goto(
    '/src/lib/core/component/LexicalMarkdown/component/core/browser-test/focus-guard.html'
  );
  const body = page.getByRole('textbox', { name: 'Document' });
  await expect(body).toContainText('Second paragraph', {
    timeout: 60_000,
  });
  return body;
}

const paragraphs = (editor: Locator) =>
  editor
    .locator('p')
    .evaluateAll((elements) =>
      elements.map((element) => element.textContent ?? '')
    );

/** Leaves the caret at the end of the document. */
async function caretAtEnd(page: Page, body: Locator) {
  await body.getByText('Second paragraph').click();
  await page.keyboard.press('End');
}

for (const name of ['Subject', 'Notes', 'Composer']) {
  test(`a background edit leaves focus in another pane's ${name}`, async ({
    page,
  }) => {
    const body = await open(page);
    await caretAtEnd(page, body);
    const field = page
      .getByRole('region', { name: 'Other pane' })
      .getByRole('textbox', { name });
    await field.click();
    await page.keyboard.type('ab');
    await page.evaluate(() => {
      const hooks: Window & { backgroundEdit?: () => void } = window;
      hooks.backgroundEdit?.();
    });
    await expect(body).toContainText('(edited)');
    await page.keyboard.type('cd');

    await expect(field).toBeFocused();
    if (name === 'Composer') await expect(field).toHaveText('abcd');
    else await expect(field).toHaveValue('abcd');
    expect(await paragraphs(body)).toEqual([
      'First paragraph',
      'Second paragraph (edited)',
    ]);
  });
}

test('editor.focus() still takes focus from another field, at the kept caret', async ({
  page,
}) => {
  const body = await open(page);
  await caretAtEnd(page, body);
  await page.getByRole('textbox', { name: 'Subject' }).click();
  await page.evaluate(() => {
    const hooks: Window & { focusDocument?: () => void } = window;
    hooks.focusDocument?.();
  });
  await expect(body).toBeFocused();
  await page.keyboard.type('!');
  expect(await paragraphs(body)).toEqual([
    'First paragraph',
    'Second paragraph!',
  ]);
});

test('a toolbar button formats the selection and keeps typing in the document', async ({
  page,
}) => {
  const body = await open(page);
  await caretAtEnd(page, body);
  await page.keyboard.press('Shift+Home');
  await page.getByRole('button', { name: 'Bold' }).click();
  await expect(
    body.locator('strong', { hasText: 'Second paragraph' }).first()
  ).toBeVisible();
  await expect(body).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('!');
  expect((await paragraphs(body))[1]).toBe('Second paragraph!');
});

test('a toolbar button that moves the caret puts typing there', async ({
  page,
}) => {
  const body = await open(page);
  await caretAtEnd(page, body);
  await page.getByRole('button', { name: 'Remove first paragraph' }).click();
  await expect(body).toBeFocused();
  await page.keyboard.type('>');
  expect(await paragraphs(body)).toEqual(['>Second paragraph']);
});

test('a menu item that moves the caret puts typing there', async ({ page }) => {
  const body = await open(page);
  await caretAtEnd(page, body);
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Insert paragraph' }).click();
  await expect(body).toBeFocused();
  await page.keyboard.type('here');
  expect(await paragraphs(body)).toEqual([
    'First paragraph',
    'Inserted here',
    'Second paragraph',
  ]);
});

test('a prompt that applies and closes leaves the caret after its change', async ({
  page,
}) => {
  const body = await open(page);
  await caretAtEnd(page, body);
  await page.getByRole('button', { name: 'Link' }).click();
  const prompt = page.getByRole('textbox', { name: 'Link URL' });
  await expect(prompt).toBeFocused();
  await page.keyboard.type('url');
  await page.keyboard.press('Enter');
  await expect(prompt).toBeHidden();
  await expect(body).toBeFocused();
  await page.keyboard.type('!');
  expect((await paragraphs(body))[1]).toBe('Second paragraph[url]!');
});

test('Enter and Tab in the title move the caret into the document', async ({
  page,
}) => {
  const body = await open(page);
  const title = page.getByRole('textbox', { name: 'Title' });
  await title.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(body).toBeFocused();
  await page.keyboard.type('Intro');
  expect(await paragraphs(body)).toEqual([
    'Intro',
    'First paragraph',
    'Second paragraph',
  ]);

  await title.click();
  await page.keyboard.press('Tab');
  await expect(body).toBeFocused();
  await page.keyboard.type('>');
  expect((await paragraphs(body))[0]).toBe('>Intro');
});

// ArrowLeft takes the same path, but this fixture's editor handles ArrowLeft
// itself before the navigation plugin sees it (with or without the patch).
for (const key of ['ArrowUp', 'Backspace']) {
  test(`${key} at the document's start moves the caret into the title`, async ({
    page,
  }) => {
    const body = await open(page);
    const title = page.getByRole('textbox', { name: 'Title' });
    // Tab from the title puts the caret at the document's start, as Lexical
    // sees it (a click then Home can race Lexical's selectionchange).
    await title.click();
    await page.keyboard.press('Tab');
    await expect(body).toBeFocused();
    await page.keyboard.press(key);
    await expect(title).toBeFocused();
    await page.keyboard.type('!');
    await expect(title).toHaveText(key === 'ArrowUp' ? '!Title' : 'Title!');
  });
}
