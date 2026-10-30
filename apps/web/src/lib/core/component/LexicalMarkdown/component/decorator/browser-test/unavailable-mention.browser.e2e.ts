import { expect, type Page, test } from '@playwright/test';

const fixture =
  '/src/lib/core/component/LexicalMarkdown/component/decorator/browser-test/unavailable-mention.html';

const cases = [
  ['Deleted event', 'Deleted', 'This event was deleted or cancelled.'],
  [
    'Deleted document',
    'Deleted',
    "This document was deleted or doesn't exist.",
  ],
  ['Deleted channel', 'Deleted', "This channel was deleted or doesn't exist."],
  ['Hidden event', 'No Access', "You don't have access to this event"],
  [
    'Deleted database',
    'Deleted',
    "This database was deleted or doesn't exist.",
  ],
  ['Hidden database', 'No Access', "You don't have access to this database"],
  ['Deleted form', 'Deleted', "This form was deleted or doesn't exist."],
  ['Hidden form', 'No Access', "You don't have access to this form"],
  ['Deleted skill', 'Deleted', "This skill was deleted or doesn't exist."],
  ['Deleted routine', 'Deleted', "This routine was deleted or doesn't exist."],
  ['Hidden routine', 'No Access', "You don't have access to this routine"],
  ['Hidden channel', 'No Access', "You don't have access to this channel"],
  [
    'Deleted agent session',
    'Deleted agent session',
    "This agent session was deleted or doesn't exist.",
  ],
  [
    'Hidden agent session',
    'Private agent session',
    "You don't have access to this agent session",
  ],
] as const;

function chip(page: Page, label: string, name: string) {
  return page
    .getByRole('paragraph')
    .filter({ hasText: `${label}:` })
    .getByText(name, { exact: true });
}

for (const [label, name, card] of cases) {
  test(`clicking the ${label.toLowerCase()} chip keeps its card open`, async ({
    page,
  }) => {
    await page.goto(fixture);
    await expect(chip(page, label, name)).toBeVisible();

    await chip(page, label, name).click();
    await expect(page.getByText(card, { exact: true })).toBeVisible();
    await expect(page.getByText(/file/)).toBeHidden();

    await page.keyboard.press('Escape');
    await expect(page.getByText(card, { exact: true })).toBeHidden();
  });
}

test('a database chip whose refetch failed keeps its loaded chip', async ({
  page,
}) => {
  await page.goto(fixture);
  const loaded = page
    .getByRole('paragraph')
    .filter({ hasText: 'Loaded database:' });
  await expect(loaded.getByText('Roadmap', { exact: true })).toBeVisible();
  await expect(loaded.getByText('No Access', { exact: true })).toBeHidden();
});

test('Enter on a deleted chip selected in a composer keeps its card open', async ({
  page,
}) => {
  await page.goto(fixture);
  const composer = page.getByRole('textbox', { name: 'Composer' });
  await expect(composer.getByText('Deleted', { exact: true })).toBeVisible();

  await composer.focus();
  await page.evaluate(() => window.selectComposerMention?.());
  await page.keyboard.press('Enter');

  await expect(
    page.getByText("This document was deleted or doesn't exist.", {
      exact: true,
    })
  ).toBeVisible();
  // The chip took the Enter; the editor did not break the line.
  await expect(composer.locator('p')).toHaveCount(1);
});

test('a hidden channel chip in a composer converts to its link as plain text', async ({
  page,
}) => {
  await page.goto(fixture);
  const composer = page.getByRole('textbox', { name: 'Composer' });
  await composer.getByText('No Access', { exact: true }).click();
  await expect(
    page.getByText("You don't have access to this channel", { exact: true })
  ).toBeVisible();

  await page.getByRole('button', { name: 'Reference actions' }).click();
  await page.getByRole('menuitem', { name: 'Convert to Plain Text' }).click();

  const origin = new URL(page.url()).origin;
  await expect(composer).toContainText(
    `after ${origin}/app/channel/01a16d55-0000-7000-8000-00000000000f end`
  );
  await expect(composer.getByText('No Access', { exact: true })).toBeHidden();
});

test.describe('on a phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  for (const [label, name, card] of cases) {
    test(`tapping the ${label.toLowerCase()} chip opens its card as a sheet`, async ({
      page,
    }) => {
      await page.goto(fixture);
      await expect(chip(page, label, name)).toBeVisible();

      // The hover card marks its trigger aria-disabled on touch, where it
      // shows nothing; a real tap still reaches the chip.
      await chip(page, label, name).tap({ force: true });
      const sheet = page.getByRole('dialog', { name: 'Preview' });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByText(card, { exact: true })).toBeVisible();
    });
  }
});
