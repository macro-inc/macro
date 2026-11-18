// The Create menu's keys for a new email: E opens it in place, shift+E in a
// split of its own beside what was open.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { did } from './ledger/record';

test.beforeEach(({ page }) => loadAppSteadily(page));

/**
 * Opens the inbox and the app's Create menu over it, with its search mode
 * off: the menu starts in search mode, where letters are typed into its
 * search, and its keys work only once / turns that off.
 */
async function openCreateMenu(page: Page, mailbox: Mailbox) {
  await mailbox.open('/app/mail');
  await expect(page.getByText('Inbox').first()).toBeVisible();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Create New' });
  await expect(
    menu.getByRole('option', { name: 'Email', exact: true })
  ).toBeVisible();
  const searchMode = menu.getByRole('switch', { name: /^Search mode/ });
  await expect(searchMode).toBeChecked();
  await page.keyboard.press('/');
  await expect(searchMode).not.toBeChecked();
}

// Gmail only: what opens is the composer, whatever the mailbox.
// When this fails, E in the Create menu opens no new email, or opens it
// somewhere else than in place of the inbox.
test('E in the Create menu opens a new email in place', async ({
  page,
  mailbox,
}) => {
  await openCreateMenu(page, mailbox);

  await page.keyboard.press('e');
  did('AC-300', 'F-095');
  await expect(page.getByRole('dialog', { name: 'Create New' })).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/mail\/new/);
  await expect(page.locator('[data-split-pane]')).toHaveCount(1);
  await expect(page.getByPlaceholder(/subject/i)).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Send email' })).toBeVisible();
});

// Gmail only: what opens is the composer, whatever the mailbox.
// When this fails, shift+E in the Create menu opens no new email, or opens
// it in place of the inbox instead of in a split beside it.
test('shift+E in the Create menu opens a new email in a split beside the inbox', async ({
  page,
  mailbox,
}) => {
  await openCreateMenu(page, mailbox);

  await page.keyboard.press('Shift+KeyE');
  did('AC-301', 'F-095');
  await expect(page.getByRole('dialog', { name: 'Create New' })).toHaveCount(0);
  const panes = page.locator('[data-split-pane]');
  await expect(panes).toHaveCount(2);
  await expect(
    panes.filter({ has: page.getByRole('button', { name: 'Send email' }) })
  ).toHaveCount(1);
  await expect(
    panes.filter({ has: page.getByRole('heading', { name: 'Inbox zero' }) })
  ).toHaveCount(1);
});
