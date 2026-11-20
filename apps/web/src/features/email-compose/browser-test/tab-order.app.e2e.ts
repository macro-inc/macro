import { expect, type Page, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // The fixture's providers would otherwise reach the hosted dev backend.
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await page.route('https://**', (route) => route.abort());
});

const field = (page: Page, label: string) =>
  page.getByText(label, { exact: true }).locator('..').getByRole('combobox');

const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)))
  );

async function open(page: Page, composer: string) {
  await page.goto(
    `/src/features/email-compose/browser-test/recipient-hotkeys.html?composer=${composer}&directory`
  );
  const body = page.locator('[contenteditable="true"]');
  await body.waitFor();
  // Replies open with their recipients collapsed into a summary.
  if (composer === 'reply') {
    await page.getByRole('button', { name: /^Replying to/ }).click();
  }
  return { to: field(page, 'To'), body };
}

// When this fails, Tab from the recipients lands on the Cc and Bcc buttons
// before Subject, or stays in the field when the typed text matches no one,
// so the subject and body can't be reached from the keyboard.
test('Tab runs To, Subject, body in a new email, and Shift+Tab goes back', async ({
  page,
}) => {
  const { to, body } = await open(page, 'new');
  const subject = page.getByRole('textbox', { name: 'Subject' });
  await to.click();
  await page.keyboard.type('ann@example.com');
  await page.keyboard.press('Enter');
  await expect(page.locator('[draggable="true"]')).toHaveCount(1);

  await page.keyboard.press('Tab');
  await expect(subject).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(body).toBeFocused();

  await subject.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(to).toBeFocused();
});

test('Tab goes through Cc and Bcc when they are shown', async ({ page }) => {
  const { to } = await open(page, 'new');
  await page.getByRole('button', { name: 'Cc', exact: true }).click();
  await page.getByRole('button', { name: 'Bcc', exact: true }).click();
  await to.focus();

  await page.keyboard.press('Tab');
  await expect(field(page, 'Cc')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(field(page, 'Bcc')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Subject' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(field(page, 'Bcc')).toBeFocused();
});

// A reply lists its thread's sender among the suggestions, so it is left out
// of the accept case here; the trap case covers it.
for (const composer of ['new', 'forward']) {
  test(`Tab accepts the highlighted suggestion in the ${composer} composer`, async ({
    page,
  }) => {
    const { to } = await open(page, composer);
    const chips = page.locator('[draggable="true"]');
    await to.click();
    await page.keyboard.type('ann');
    await expect(
      page.getByRole('option').filter({ hasText: 'Ann Rivera' })
    ).toBeVisible();
    await expect(page.locator('[role="option"][data-highlighted]')).toHaveCount(
      1
    );
    await page.keyboard.press('Tab');
    await expect(chips).toHaveCount(1);
    await expect(to).toBeFocused();
  });
}

test('Tab adds a typed address with a trailing space', async ({ page }) => {
  const { to } = await open(page, 'new');
  await to.click();
  await page.keyboard.type('new@example.com ');
  await page.keyboard.press('Tab');
  await expect(page.locator('[draggable="true"]')).toHaveCount(1);
  await expect(to).toBeFocused();
});

// Text that isn't an address is cleared as focus moves on, as a click
// elsewhere clears it.
for (const composer of ['new', 'reply', 'forward']) {
  test(`Tab moves on from text that matches no one in the ${composer} composer`, async ({
    page,
  }) => {
    const { to } = await open(page, composer);
    const reads = page.getByTestId('directory-reads');
    await to.click();
    await settle(page);
    const readsBefore = Number(await reads.textContent());
    await page.keyboard.type('nobody by this name');
    // Wait for the typed query's own read, not the empty list before it.
    await expect
      .poll(async () => Number(await reads.textContent()))
      .toBeGreaterThan(readsBefore);
    await expect(page.getByTestId('directory-rows')).toHaveText('0');
    await page.keyboard.press('Tab');
    await expect(to).not.toBeFocused();
    await expect(to).toHaveValue('');
  });
}

// Without this, Shift+Tab anywhere but the very start of the body is taken
// by outdenting, even when there is nothing to outdent.
for (const composer of ['new', 'reply']) {
  test(`Shift+Tab in the body outdents, then goes back in the ${composer} composer`, async ({
    page,
  }) => {
    const { to, body } = await open(page, composer);
    const previous =
      composer === 'new' ? page.getByRole('textbox', { name: 'Subject' }) : to;
    await body.click();
    await page.keyboard.type('- one');
    await page.keyboard.press('Enter');
    await page.keyboard.type('two');
    // Tab at the very end of a new email's body moves on, so indent from
    // inside the item. The editor ignores a caret move that lands with its
    // own selection update, so let each settle first.
    await settle(page);
    await page.keyboard.press('ArrowLeft');
    await settle(page);
    await page.keyboard.press('Tab');
    await expect(body.locator('ul ul')).toHaveCount(1);

    await page.keyboard.press('Shift+Tab');
    await expect(body.locator('ul ul')).toHaveCount(0);
    await expect(body).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(previous).toBeFocused();
  });
}

for (const composer of ['forward']) {
  test(`Shift+Tab leaves the body in the ${composer} composer`, async ({
    page,
  }) => {
    const { to, body } = await open(page, composer);
    await body.click();
    await page.keyboard.type('hello');
    await page.keyboard.press('Shift+Tab');
    await expect(body).not.toBeFocused();
    await expect(to).toBeFocused();
  });
}
