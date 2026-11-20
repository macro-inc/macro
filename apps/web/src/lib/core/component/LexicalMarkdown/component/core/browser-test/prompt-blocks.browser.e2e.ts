import { expect as baseExpect, type Page, test } from '@playwright/test';

// The first prompt card loads the run controls' chunk from the dev server.
const expect = baseExpect.configure({ timeout: 15_000 });

const PROMPT_START = 'I am joining the team.';

test.beforeEach(async ({ page, context }) => {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost') await route.continue();
    else await route.abort();
  });
  await page.goto(
    '/src/lib/core/component/LexicalMarkdown/component/core/browser-test/prompt-blocks.html'
  );
});

async function openedSplits(page: Page) {
  return await page.evaluate(() => window.openedSplits);
}

test('a sent prompt runs with an agent only after the viewer proceeds', async ({
  page,
}) => {
  const message = page.getByTestId('message');
  const card = message.locator('[data-prompt-block]');
  await expect(card).toContainText('Prompt');
  await expect(card).toContainText(PROMPT_START);

  // The picker starts on Auto and lists the agents that can start.
  const picker = card.getByRole('button', { name: 'Agent to run with' });
  await expect(picker).toHaveText('Auto');
  await picker.click();
  await expect(page.getByRole('menuitemradio', { name: /Auto/ })).toBeChecked();
  await expect(
    page.getByRole('menuitemradio', { name: 'Macro' })
  ).toBeVisible();
  await page.keyboard.press('Escape');

  const run = card.getByRole('button', { name: 'Run prompt' });
  await run.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Run this prompt?');
  await expect(dialog).toContainText('read and change your workspace');
  await expect(dialog).toContainText(PROMPT_START);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(await openedSplits(page)).toEqual([]);

  await run.click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Proceed' })
    .click();
  await expect.poll(() => openedSplits(page)).toHaveLength(1);
  const [opened] = await openedSplits(page);
  expect(opened).toMatchObject({
    content: { type: 'agent' },
    options: { preferNewSplit: true },
  });
});

test('email shows a prompt fence as code', async ({ page }) => {
  const email = page.getByTestId('email');
  await expect(email).toContainText(PROMPT_START);
  await expect(email.locator('[data-prompt-block]')).toHaveCount(0);
  await expect(email.getByRole('button', { name: 'Run prompt' })).toHaveCount(
    0
  );
});

test('a code block becomes a prompt from its type menu, except in email', async ({
  page,
}) => {
  const documentSection = page.getByTestId('document');
  await documentSection.getByRole('button', { name: 'Plain Text' }).click();
  await page.getByRole('menuitem', { name: 'Executable prompt' }).click();
  const prompt = documentSection.locator('.md-prompt-box');
  await expect(prompt).toHaveText('Summarize my week');
  await expect(
    documentSection.getByRole('button', { name: 'Run prompt' })
  ).toBeVisible();

  const email = page.getByTestId('email-composer');
  await email
    .getByRole('textbox', { name: 'Email body' })
    .scrollIntoViewIfNeeded();
  await email.getByRole('button', { name: 'Plain Text' }).click();
  await expect(
    page.getByRole('menuitem', { name: 'JavaScript' })
  ).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: 'Executable prompt' })
  ).toHaveCount(0);
});

test('/prompt turns the current line into a prompt block', async ({
  page,
  hasTouch,
}) => {
  test.skip(hasTouch, 'The slash menu is typed from a hardware keyboard');
  const documentSection = page.getByTestId('document');
  await documentSection.getByText('Onboarding').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await expect(page.getByText('Normal Text', { exact: true })).toBeVisible();
  await page.keyboard.type('prompt');
  // The menu filters on a short debounce; Enter picks its first match.
  await expect(page.getByText('Normal Text', { exact: true })).toBeHidden();
  await page.keyboard.press('Enter');
  await page.keyboard.type('Plan my day');
  await expect(documentSection.locator('.md-prompt-box')).toHaveText(
    'Plan my day'
  );
});
