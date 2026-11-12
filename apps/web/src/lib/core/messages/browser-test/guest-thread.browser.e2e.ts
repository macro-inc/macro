import { expect, type Locator, type Page, test } from '@playwright/test';

async function openActions(page: Page, row: Locator, phone: boolean) {
  if (!phone) {
    await row.hover();
    return row;
  }
  await row.evaluate((element) => {
    const touch = new Touch({
      identifier: 1,
      target: element,
      clientX: 20,
      clientY: 20,
    });
    element.dispatchEvent(
      new TouchEvent('touchstart', {
        bubbles: true,
        touches: [touch],
        targetTouches: [touch],
        changedTouches: [touch],
      })
    );
  });
  const drawer = page.getByRole('dialog', { name: 'Message actions' });
  await expect(drawer).toBeVisible();
  return drawer;
}

test('guest can use the shared thread and text composer without app providers', async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await page.goto('/src/lib/core/messages/browser-test/guest-thread.html', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByText('Participant message')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Guest message')).toBeVisible();
  await expect(page.getByText('Own message')).toBeVisible();
  await expect(page.getByText('Participant', { exact: true })).toBeVisible();
  await expect(
    page.locator('[data-message-id="own-message"] [data-message-reaction-chip]')
  ).toHaveAttribute('aria-pressed', 'true');
  if (testInfo.project.name === 'desktop') {
    await page
      .locator(
        '[data-message-id="participant-message"] [data-message-reaction-chip]'
      )
      .hover();
    await expect(page.getByText(/Visitor reacted with/)).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Attach files' })).toHaveCount(
    0
  );
  await expect(
    page.getByRole('button', { name: /dictat|microphone/i })
  ).toHaveCount(0);

  const own = page.locator('[data-message-id="own-message"]');
  if (testInfo.project.name === 'phone') {
    await own.tap();
    await own.dispatchEvent('contextmenu');
  } else {
    await own.hover();
  }
  // The preselected reaction can be removed through the shared chip.
  await own.locator('[data-message-reaction-chip]').click();
  await expect(page.getByRole('status', { name: 'Last action' })).toHaveText(
    'react:own-message:false'
  );

  const editor = page.locator(
    '[data-input-id="guest-composer"] [contenteditable]'
  );
  await editor.fill('New guest message');
  await page
    .locator('[data-input-id="guest-composer"]')
    .getByRole('button', { name: 'Send message' })
    .click();
  await expect(page.getByText('New guest message')).toBeVisible();
  await expect(page.getByRole('status', { name: 'Last action' })).toHaveText(
    'compose'
  );
  expect(pageErrors).toEqual([]);
});

test('guest edits and deletes only their own message', async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await page.goto('/src/lib/core/messages/browser-test/guest-thread.html', {
    waitUntil: 'domcontentloaded',
  });
  const phone = testInfo.project.name === 'phone';
  const other = page.locator('[data-message-id="participant-message"]');
  const otherActions = await openActions(page, other, phone);
  await expect(otherActions.getByRole('button', { name: 'Edit' })).toHaveCount(
    0
  );
  await expect(
    otherActions.getByRole('button', { name: 'Delete' })
  ).toHaveCount(0);
  await otherActions.getByRole('button', { name: 'React 👍' }).click();
  await expect(page.getByRole('status', { name: 'Last action' })).toHaveText(
    'react:participant-message:true'
  );
  if (phone) await page.keyboard.press('Escape');

  const own = page.locator('[data-message-id="own-message"]');
  const ownActions = await openActions(page, own, phone);
  await ownActions.getByRole('button', { name: 'Edit' }).click();
  const editor = page.locator(
    '[data-input-id="edit-message-input-own-message"] [contenteditable]'
  );
  await editor.fill('Edited guest message');
  await page
    .locator('[data-input-id="edit-message-input-own-message"]')
    .getByRole('button', { name: 'Send message' })
    .click();
  await expect(own.getByText('Edited guest message')).toBeVisible();
  await expect(page.getByRole('status', { name: 'Last action' })).toHaveText(
    'edit:own-message'
  );

  const deleteActions = await openActions(page, own, phone);
  await deleteActions.getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete message' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.getByRole('status', { name: 'Last action' })).toHaveText(
    'delete:own-message'
  );
  expect(pageErrors).toEqual([]);
});
