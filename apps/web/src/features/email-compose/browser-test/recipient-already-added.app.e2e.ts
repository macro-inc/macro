import { expect, type Page, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // The fixture's providers would otherwise reach the hosted dev backend.
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await page.route('https://**', (route) => route.abort());
});

// Phones label the row "To:".
const row = (page: Page, label: string) =>
  page.getByText(new RegExp(`^${label}:?$`)).locator('..');

const field = (page: Page, label: string) =>
  row(page, label).getByRole('combobox');

const chips = (page: Page, label: string) =>
  row(page, label).locator('[draggable="true"]');

async function open(page: Page, composer: string) {
  const mobile = test.info().project.name === 'phone' ? '&mobile' : '';
  await page.goto(
    `/src/features/email-compose/browser-test/recipient-hotkeys.html?composer=${composer}&directory${mobile}`
  );
  await page.locator('[contenteditable="true"]').waitFor();
  // Replies open with their recipients collapsed into a summary.
  if (composer === 'reply') {
    await page.getByRole('button', { name: /^Replying to/ }).click();
  }
}

// When this fails, a reply's To lists its thread's sender, already a
// recipient, as a match for "ann" and highlights it while the directory
// loads; Enter or Tab then removes the sender instead of adding the person
// typed.
for (const key of ['Enter', 'Tab']) {
  test(`${key} on a typed name keeps the sender already in a reply's To`, async ({
    page,
  }) => {
    await open(page, 'reply');
    const to = field(page, 'To');
    await expect(chips(page, 'To')).toHaveCount(1);
    await expect(chips(page, 'To').first()).toContainText('sender@example.com');

    await to.click();
    await page.keyboard.type('ann');
    await expect(
      page.getByRole('option').filter({ hasText: 'Ann Rivera' })
    ).toBeVisible();
    await page.keyboard.press(key);

    await expect(chips(page, 'To')).toHaveCount(2);
    await expect(chips(page, 'To').first()).toContainText('sender@example.com');
  });
}

// When this fails, picking a name already in the field removes it.
for (const label of ['To', 'Cc', 'Bcc']) {
  test(`a name already in ${label} is shown as added and picking it keeps it`, async ({
    page,
  }, info) => {
    const phone = info.project.name === 'phone';
    // Phones fold Cc and Bcc into one row behind a button; To is the same
    // field there.
    test.skip(phone && label !== 'To');
    await open(page, 'new');
    if (label !== 'To') {
      await page.getByRole('button', { name: label, exact: true }).click();
    }
    const input = field(page, label);
    await input.click();
    await page.keyboard.type('ann@example.com');
    await page.keyboard.press('Enter');
    await expect(chips(page, label)).toHaveCount(1);

    await page.keyboard.type('ann');
    const added = page
      .getByRole('option')
      .filter({ hasText: 'ann@example.com' });
    // A click or tap on the dimmed row does nothing.
    if (phone) await added.tap({ force: true });
    else await added.click({ force: true });
    await expect(chips(page, label)).toHaveCount(1);
    await expect(chips(page, label).first()).toContainText('ann@example.com');
    await expect(added).toHaveAttribute('aria-disabled', 'true');
    await expect(added).toHaveAttribute('aria-selected', 'true');
    await expect(added).not.toHaveAttribute('data-highlighted');

    // Enter adds the highlighted match, another person.
    await expect(page.locator('[role="option"][data-highlighted]')).toHaveCount(
      1
    );
    await page.keyboard.press('Enter');
    await expect(chips(page, label)).toHaveCount(2);
    await expect(chips(page, label).first()).toContainText('ann@example.com');

    // Chips still come off, with their X or Backspace.
    await chips(page, label).first().locator('svg').last().click();
    await expect(chips(page, label)).toHaveCount(1);
    await expect(chips(page, label).first()).not.toContainText(
      'ann@example.com'
    );
    await input.focus();
    await page.keyboard.press('Backspace');
    await expect(chips(page, label)).toHaveCount(0);
  });
}
