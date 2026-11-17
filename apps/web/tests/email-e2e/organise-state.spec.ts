// A thread's state changed back from the list: marked not done from
// Archived, unstarred from its row, brought back from Trash with the toast's
// Undo; and the notices that say a change still waits for the mailbox. Each
// for a Gmail and an Outlook inbox.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { emulatorUrl, trashFolder } from './harness/journeys';
import { focusRow, openThreadId, rowIds } from './harness/list';
import { notice } from './harness/send';
import type { Provider } from './harness/stack';
import { confirmed, did, saw } from './ledger/record';

const from = 'Grace <grace@example.com>';

/** The row of a thread in the list. */
function row(page: Page, threadId: string) {
  return page.locator(`[data-soup-entity] [data-entity-id="${threadId}"]`);
}

/** The provider's copy of the message with this subject. */
async function held(mailbox: Mailbox, subject: string) {
  return (await mailbox.providerMessages()).find(
    (message) => message.subject === subject
  );
}

/** The threads the storage service holds as the user's favorites. */
async function favorites(mailbox: Mailbox): Promise<string[]> {
  const response = await mailbox.api('/dss/favorites');
  const body = (await response.json()) as {
    favorites: { entityType: string; entityId: string }[];
  };
  return body.favorites
    .filter(({ entityType }) => entityType === 'email_thread')
    .map(({ entityId }) => entityId);
}

/**
 * Makes the provider answer a route late, so a change Macro has accepted
 * stays unconfirmed for that long.
 */
async function delayProvider(
  mailbox: Mailbox,
  route: string,
  delayMs: number
): Promise<void> {
  const response = await fetch(
    `${emulatorUrl(mailbox, mailbox.inbox.provider)}/_emulator/faults`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ route, delay_ms: delayMs }),
    }
  );
  if (!response.ok) {
    throw new Error(
      `delay refused: ${response.status} ${await response.text()}`
    );
  }
}

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

for (const provider of PROVIDERS) {
  test.describe(`a thread's state in ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, Unarchive on a done thread shows its notice (or
    // nothing) and the thread stays out of the inbox, in Macro or at the
    // provider.
    test('a done thread marked not done is back in the inbox', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Agenda', text: 'About Agenda.' });
      await mailbox.deliver({ from, subject: 'Minutes', text: 'Attached.' });
      const agenda = await mailbox.synced('Agenda');
      await mailbox.synced('Minutes');
      const library = page.getByRole('navigation', { name: 'Email library' });
      const tabs = page.getByRole('navigation', { name: 'Email tabs' });

      await mailbox.open();
      await focusRow(page, agenda.id);
      await page.keyboard.press('e');
      await expect(row(page, agenda.id)).toHaveCount(0);
      await expect
        .poll(async () => (await held(mailbox, 'Agenda'))?.inInbox)
        .toBe(false);

      await library.getByRole('button', { name: 'Archived' }).click();
      await expect(page).toHaveURL(/tab=archived/);
      await expect.poll(() => rowIds(page)).toEqual([agenda.id]);
      await row(page, agenda.id).hover();
      await expect(
        row(page, agenda.id).getByRole('button', { name: 'Unarchive email' })
      ).toBeEnabled();
      saw('STL-037', 'F-072');
      await row(page, agenda.id)
        .getByRole('button', { name: 'Unarchive email' })
        .click();
      did('AL-063');
      await expect(notice(page, 'Marked as not done')).toBeVisible();
      saw('STL-042');

      await tabs.getByRole('button', { name: 'Inbox' }).click();
      await expect(page).not.toHaveURL(/tab=archived/);
      await expect.poll(() => rowIds(page)).toContain(agenda.id);
      saw('STL-954');
      await expect
        .poll(async () => (await held(mailbox, 'Agenda'))?.inInbox)
        .toBe(true);
      confirmed('F-072');
    });

    // When this fails, the star stays on the row, or comes off the row while
    // the thread is still one of the user's favorites.
    test('unstarring a row takes the thread out of the favorites', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Agenda', text: 'About Agenda.' });
      await mailbox.deliver({ from, subject: 'Minutes', text: 'Attached.' });
      const agenda = await mailbox.synced('Agenda');
      await mailbox.synced('Minutes');

      await mailbox.open();
      await focusRow(page, agenda.id);
      await page.keyboard.press('s');
      await expect(notice(page, 'Added to favorites')).toBeVisible();
      await expect.poll(() => favorites(mailbox)).toEqual([agenda.id]);

      const star = row(page, agenda.id).getByRole('button', {
        name: 'Unstar email',
      });
      await row(page, agenda.id).hover();
      await expect(star).toBeEnabled();
      await star.click();
      did('AL-060', 'F-074');
      await expect(notice(page, 'Removed from favorites')).toBeVisible();
      saw('STL-048', 'F-074');
      await expect(
        row(page, agenda.id).getByRole('button', { name: 'Star email' })
      ).toBeVisible();
      await expect(star).toHaveCount(0);
      saw('STL-036', 'F-074');
      // The star is a Macro favorite: the storage service holds it.
      await expect.poll(() => favorites(mailbox)).toEqual([]);
      confirmed('F-074');
    });

    // When this fails, Undo in the "Moved to Trash" notice does nothing: the
    // thread stays in the provider's trash and out of the list.
    test('Undo in the Trash notice brings the thread back', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Agenda', text: 'About Agenda.' });
      await mailbox.deliver({ from, subject: 'Minutes', text: 'Attached.' });
      const agenda = await mailbox.synced('Agenda');
      await mailbox.synced('Minutes');

      await mailbox.open();
      await focusRow(page, agenda.id);
      // '#' as a keyboard types it: Shift with the 3 key.
      await page.keyboard.press('Shift+Digit3');
      await expect(row(page, agenda.id)).toHaveCount(0);
      // The notice stays for as long as the pointer is on it: the provider
      // can take longer over the move than the notice otherwise lasts.
      const moved = notice(page, 'Moved to Trash');
      await moved.hover();
      await expect
        .poll(async () => (await held(mailbox, 'Agenda'))?.labels)
        .toContain(trashFolder(provider));

      await moved.getByRole('button', { name: 'Undo' }).click();
      did('AL-414');
      await expect(notice(page, 'Restored from Trash')).toBeVisible();
      saw('STL-408');
      await expect.poll(() => rowIds(page)).toContain(agenda.id);
      await expect
        .poll(async () => (await held(mailbox, 'Agenda'))?.labels)
        .not.toContain(trashFolder(provider));
      expect((await held(mailbox, 'Agenda'))?.inInbox).toBe(true);
      confirmed('F-083');
    });

    // When this fails, a block the mailbox has not confirmed yet looks
    // finished: Settings › Email says nothing about the change in progress.
    test('Settings names a sender block that waits for the mailbox', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Agenda', text: 'About Agenda.' });
      const agenda = await mailbox.synced('Agenda');
      // The block is a filter at Gmail and an inbox rule at Outlook.
      await delayProvider(
        mailbox,
        provider === 'GMAIL' ? 'settings.filters.create' : 'rules.create',
        30_000
      );
      const waiting = async () => {
        const response = await mailbox.api('/email/email/settings/operations');
        return (
          (await response.json()) as {
            kind: string;
            resource: string;
            enabled: boolean;
            needs_attention: boolean;
          }[]
        ).map(({ kind, resource, enabled, needs_attention }) => ({
          kind,
          resource,
          enabled,
          needs_attention,
        }));
      };

      await mailbox.open();
      await row(page, agenda.id).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Block Sender' }).click();
      await expect(notice(page, 'Sender block queued')).toBeVisible();

      await mailbox.open('/app/mail/~/settings/email');
      await expect(
        page.getByText(
          'Block grace@example.com: Waiting for mailbox confirmation.'
        )
      ).toBeVisible();
      saw('STX-019');
      // Waiting for the mailbox, not for a retry.
      expect(await waiting()).toEqual([
        {
          kind: 'sender_block',
          resource: 'grace@example.com',
          enabled: true,
          needs_attention: false,
        },
      ]);
      confirmed('F-180');
    });
  });
}

test.describe('a change the Outlook mailbox has not confirmed', () => {
  test.use({ provider: 'OUTLOOK' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // Only an Outlook mailbox takes its changes as operations that the thread
  // can list. When this fails, a thread marked unread says nothing while
  // Outlook still holds it as read.
  test('the open thread says its unread mark waits for the mailbox', async ({
    page,
    mailbox,
  }) => {
    await mailbox.deliver({ from, subject: 'Agenda', text: 'About Agenda.' });
    await mailbox.deliver({ from, subject: 'Minutes', text: 'Attached.' });
    const agenda = await mailbox.synced('Agenda');
    await mailbox.synced('Minutes');
    const operations = async () => {
      const response = await mailbox.api(
        `/email/email/threads/${agenda.id}/operations`
      );
      return (
        (await response.json()) as {
          action: { kind: string; value: unknown };
          state: string;
        }[]
      ).map(({ action, state }) => ({ ...action, state }));
    };

    await page.setViewportSize({ width: 1600, height: 900 });
    await mailbox.open();
    await expect.poll(() => rowIds(page)).toContain(agenda.id);
    await page.getByRole('button', { name: 'Show reading pane' }).click();
    await row(page, agenda.id).click();
    await expect.poll(() => openThreadId(page)).toBe(agenda.id);
    await expect(page.getByText('About Agenda.')).toBeVisible();
    // Opening it marked it read; that is done before the unread is asked.
    await expect
      .poll(operations)
      .toEqual([{ kind: 'read', value: true, state: 'applied' }]);

    await delayProvider(mailbox, 'messages.update', 8_000);
    await page.keyboard.press('u');
    await expect(
      page.getByText('Mark as unread: Waiting for mailbox confirmation.')
    ).toBeVisible();
    saw('STL-080');
    saw('STL-082');
    expect(await operations()).toEqual([
      { kind: 'read', value: false, state: 'pending' },
    ]);
    confirmed('F-180');

    // Confirmed in the end: the notice goes and Outlook holds it unread.
    await expect
      .poll(async () => (await held(mailbox, 'Agenda'))?.read, {
        timeout: 40_000,
      })
      .toBe(false);
    await expect(
      page.getByText('Mark as unread: Waiting for mailbox confirmation.')
    ).toBeHidden();
  });
});
