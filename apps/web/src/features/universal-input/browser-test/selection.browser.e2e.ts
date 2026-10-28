import { expect, type Page, test } from '@playwright/test';

async function select(page: Page, passage: string) {
  await page.evaluate((id) => {
    // The email passage renders in a shadow root, like the email renderer's.
    const find = (root: Document | ShadowRoot): Element | undefined => {
      const direct = root.querySelector(`[data-testid="${id}"]`);
      if (direct) return direct;
      for (const element of root.querySelectorAll('*'))
        if (element.shadowRoot) {
          const nested = find(element.shadowRoot);
          if (nested) return nested;
        }
    };
    const node = find(document);
    if (!node) throw new Error(`no passage ${id}`);
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, passage);
}

const offer = (page: Page) => page.getByTestId('selection-offer');
const draft = (page: Page) => page.getByTestId('selection-draft');
const top = (page: Page, testId: string) =>
  page
    .getByTestId(testId)
    .evaluate((element) => element.getBoundingClientRect().top);

const CHANNEL_TEXT =
  'let us meet for coffee at 8am tomorrow before the standup';

test('an event in a channel message becomes a card beside it, and creates the event', async ({
  page,
}) => {
  await page.goto('/?selection');
  await select(page, 'channel-passage');
  await expect(offer(page)).toHaveText('Create event');

  const passage = await top(page, 'channel-passage');
  const chip = await offer(page).evaluate(
    (element) => element.getBoundingClientRect().bottom
  );
  // The chip reads as belonging to the text: just above it, not over it.
  expect(chip).toBeLessThanOrEqual(passage);
  expect(passage - chip).toBeLessThanOrEqual(24);

  await offer(page).click();
  await expect(offer(page)).toHaveCount(0);
  await expect(draft(page)).toContainText(CHANNEL_TEXT);
  await expect(
    draft(page).getByRole('textbox', { name: 'Title', exact: true })
  ).toHaveValue('Call John');

  const create = draft(page).getByRole('button', {
    name: 'Create event',
    exact: true,
  });
  await expect(create).toBeEnabled();
  await create.click();
  await expect(draft(page)).toHaveCount(0);
  await expect(page.getByTestId('selection-submission-count')).toHaveText('1');
  const submitted = await page
    .getByTestId('last-selection-submission')
    .textContent();
  expect(JSON.parse(submitted ?? '{}')).toMatchObject({
    intent: 'calendar',
    text: CHANNEL_TEXT,
  });
});

test('offers nothing for a question, an unmarked surface, or a passage too short to shape', async ({
  page,
}) => {
  await page.goto('/?selection');
  await select(page, 'question-passage');
  await expect(offer(page)).toHaveCount(0);
  await select(page, 'unmarked-passage');
  await expect(offer(page)).toHaveCount(0);
  await select(page, 'short-passage');
  await expect(offer(page)).toHaveCount(0);
  // The same page still offers a shape it does recognize.
  await select(page, 'email-passage');
  await expect(offer(page)).toHaveText('Create task');
});

test('reads an email body out of the shadow root its renderer mounts', async ({
  page,
}) => {
  await page.goto('/?selection');
  await select(page, 'email-passage');
  await expect(offer(page)).toHaveText('Create task');
  await offer(page).click();
  await expect(draft(page)).toContainText(
    'ship the onboarding checklist before the release on Thursday'
  );
});

test('a dismissed passage is left alone until the reader selects something else', async ({
  page,
}) => {
  await page.goto('/?selection');
  await select(page, 'channel-passage');
  await offer(page).click();
  await expect(draft(page)).toBeVisible();
  await draft(page)
    .getByRole('button', { name: 'Dismiss', exact: true })
    .click();
  await expect(draft(page)).toHaveCount(0);

  await select(page, 'channel-passage');
  await expect(offer(page)).toHaveCount(0);
  await select(page, 'email-passage');
  await expect(offer(page)).toHaveText('Create task');
});

test('takes focus from the chip, so Escape closes the card without a field click', async ({
  page,
}) => {
  await page.goto('/?selection');
  await select(page, 'channel-passage');
  await offer(page).click();
  await expect(draft(page)).toBeVisible();
  // Taking focus leaves the text highlighted, so the card still reads as
  // belonging to it.
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
    CHANNEL_TEXT
  );
  await page.keyboard.press('Escape');
  await expect(draft(page)).toHaveCount(0);
  await expect(offer(page)).toHaveCount(0);
});

test('keeps the card on its text while the fields are filled in', async ({
  page,
}) => {
  await page.goto('/?selection');
  await select(page, 'channel-passage');
  await offer(page).click();
  const title = draft(page).getByRole('textbox', {
    name: 'Title',
    exact: true,
  });
  const before = await draft(page).evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left, top: bounds.top };
  });
  await title.fill('Coffee with the design team');
  await expect(title).toHaveValue('Coffee with the design team');
  const after = await draft(page).evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left, top: bounds.top };
  });
  // Typing into a field puts the caret there, leaving no selection to follow;
  // the card holds the place it was opened on.
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  expect(Math.abs(after.left - before.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1);
});
