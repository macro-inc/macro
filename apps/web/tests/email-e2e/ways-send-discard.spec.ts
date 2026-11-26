// A discard the server never confirmed, from the banner of the draft it left
// behind: Retry discard throws the draft away after all, and Keep editing
// takes it back as a draft to go on with. For a Gmail and an Outlook inbox;
// only an Outlook mailbox holds a copy of Macro's draft (see
// harness/ways-send-more.ts), so only there is the mailbox checked too.

import type { Page } from '@playwright/test';
import {
  body,
  composeNew,
  discardButton,
  draftThreads,
  graphqlOperation,
  loadAppSteadily,
  routeDraftId,
} from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { threadMessages } from './harness/send';
import { draftAtProvider } from './harness/ways-send-more';
import { did } from './ledger/record';

const SUBJECT = 'Offsite plan';

async function draftNames(mailbox: Mailbox): Promise<string[]> {
  return (await draftThreads(mailbox)).map((thread) => String(thread.name));
}

/** The text of the one draft the service holds. */
async function savedText(mailbox: Mailbox): Promise<string> {
  const [thread] = await draftThreads(mailbox);
  if (!thread) return '';
  const [draft] = await threadMessages(mailbox, thread.id);
  return String(draft?.body_html_sanitized ?? '');
}

/**
 * A saved draft discarded while the server faults on every discard, until
 * the queue gives up on it; then opened again from Drafts. Returns what lets
 * the server take discards again.
 */
async function discardUnconfirmed(
  page: Page,
  mailbox: Mailbox
): Promise<() => void> {
  let faulting = true;
  await page.route(/\/graphql$/, async (route) => {
    if (!faulting || graphqlOperation(route.request()) !== 'DeleteEmailDraft')
      return route.fallback();
    await route.fulfill({
      json: {
        data: null,
        errors: [
          {
            message: 'internal',
            path: ['deleteEmailDraft'],
            extensions: { code: 'INTERNAL' },
          },
        ],
      },
    });
  });
  await composeNew(page, mailbox, {
    to: 'grace@example.com',
    subject: SUBJECT,
    body: 'Thinking of the coast.',
  });
  await routeDraftId(page);
  await expect.poll(() => draftNames(mailbox)).toEqual([SUBJECT]);
  if (mailbox.inbox.provider === 'OUTLOOK')
    await expect
      .poll(async () => (await draftAtProvider(mailbox, SUBJECT))?.body)
      .toContain('Thinking of the coast.');
  await discardButton(page).click();
  // The new-email route starts over with an empty composer.
  await expect(page.getByPlaceholder(/subject/i)).toHaveValue('');

  await mailbox.open('/app/mail');
  await page
    .getByRole('navigation', { name: 'Email tabs' })
    .getByRole('button', { name: 'Drafts' })
    .click();
  const row = page
    .getByRole('grid', { name: 'Email' })
    .getByRole('row')
    .filter({ hasText: 'Not synced' });
  await expect(row).toContainText(SUBJECT);
  await row.click();
  await expect(banner(page)).toContainText('Discard could not be confirmed.');
  return () => {
    faulting = false;
  };
}

function banner(page: Page) {
  return page
    .getByRole('alert')
    .filter({ hasText: 'Draft could not be synced' });
}

for (const provider of PROVIDERS) {
  test.describe(`a discard the server never confirmed, in ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, Retry discard on a draft whose discard never went
    // through does not discard it again: the draft stays in Macro's drafts,
    // or in an Outlook mailbox.
    test('Retry discard throws the draft away', async ({ page, mailbox }) => {
      const recover = await discardUnconfirmed(page, mailbox);
      expect(await draftNames(mailbox)).toEqual([SUBJECT]);

      recover();
      await banner(page)
        .getByRole('button', { name: 'Retry discard', exact: true })
        .click();
      did('AC-400', 'F-119');
      did('AC-400', 'F-120');
      await expect.poll(() => draftNames(mailbox)).toEqual([]);
      if (provider === 'OUTLOOK')
        await expect
          .poll(() => draftAtProvider(mailbox, SUBJECT))
          .toBeUndefined();
    });

    // When this fails, Keep editing on a draft whose discard never went
    // through does not take it back: the banner stays, or what is typed
    // next is never saved to the draft.
    test('Keep editing takes the draft back and saves what is typed next', async ({
      page,
      mailbox,
    }) => {
      const recover = await discardUnconfirmed(page, mailbox);
      recover();

      await banner(page)
        .getByRole('button', { name: 'Keep editing', exact: true })
        .click();
      did('AC-066');
      await expect(banner(page)).toHaveCount(0);
      await body(page).click();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type(' Or the hills.');
      await expect
        .poll(() => savedText(mailbox))
        .toContain('Thinking of the coast. Or the hills.');
      if (provider === 'OUTLOOK')
        await expect
          .poll(async () => (await draftAtProvider(mailbox, SUBJECT))?.body)
          .toContain('Thinking of the coast. Or the hills.');
      expect(await draftNames(mailbox)).toEqual([SUBJECT]);
    });
  });
}
