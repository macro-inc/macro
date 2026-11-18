// What the Remind me menu shows besides its times: why typed text offers
// none, the menu while a reminder saves, and its alerts when the save is
// refused, when the server answers with a reminder that is not pending, and
// when the thread's reminder cannot be read.
//
// A reminder is the storage service's, not the mailbox's: the menu reads and
// writes it the same way whichever mailbox the thread is in. Gmail on the
// desktop, from a row's menu; Outlook on the phone, from the thread's menu.

import type { Locator, Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import {
  hold,
  method,
  NATURAL_TIME_WASM,
  refuse,
  reminderOf,
  remindMenu,
  sheetIn,
} from './harness/states-organise';
import { PHONE } from './harness/ways-list1';
import { deliverAll, rowMenu } from './harness/ways-organise';
import { expectReminder, remindWhen } from './harness/ways-organise-more';
import { phoneHeaderSubject } from './harness/ways-thread-more';
import { saw } from './ledger/record';

const SUBJECTS = ['Agenda', 'Minutes', 'Budget', 'Lunch'] as const;
type Ids = Record<(typeof SUBJECTS)[number], string>;

/** Opens the Remind me menu of a thread. */
type Open = (id: string, subject: string) => Promise<void>;
/** Clicks on a desktop, taps on a phone. */
type Press = (target: Locator) => Promise<void>;

/**
 * Puts each thread's faults in place before the page loads: the reader of
 * typed times held, Minutes' save refused, Budget's answered as a reminder
 * that already came back, and Lunch's reminder unreadable until `readable`.
 */
async function faults(
  page: Page,
  ids: Ids
): Promise<{
  typedTimes: Awaited<ReturnType<typeof hold>>;
  readable: () => void;
}> {
  const typedTimes = await hold(page, NATURAL_TIME_WASM);
  await refuse(page, reminderOf(ids.Minutes), method('PUT'));
  // The server answers a set this way when the reminder ended before the
  // answer left (its time passed, or a reply came): a stand-in for that race.
  await page.route(reminderOf(ids.Budget), async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    const saved = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...saved, state: 'returned' } });
  });
  let failing = true;
  await refuse(page, reminderOf(ids.Lunch), method('GET'), () => failing);
  return {
    typedTimes,
    readable: () => {
      failing = false;
    },
  };
}

/** Walks the menu through its states, one thread for each fault. */
async function menuStates(
  page: Page,
  mailbox: Mailbox,
  ids: Ids,
  shared: Awaited<ReturnType<typeof faults>>,
  open: Open,
  press: Press
): Promise<void> {
  const menu = remindMenu(page);
  const when = remindWhen(page);
  const tomorrow = menu.getByRole('option', { name: /^tomorrow 9am/ });
  const cancel = menu.getByRole('button', { name: 'Cancel' });
  const choose = async () => {
    await when.fill('tomorrow 9am');
    // Until the menu has read the thread's reminder its times are disabled.
    await expect(tomorrow).toBeEnabled();
    await press(tomorrow);
  };

  await open(ids.Agenda, 'Agenda');
  await when.fill('zzz');
  await expect(
    menu.getByText('Enter a future time, like in 2 hours or tomorrow 9am.')
  ).toBeVisible();
  saw('STL-625');
  await shared.typedTimes.release();
  await expect(
    menu.getByText(
      'Couldn’t read that as a time. Try in 2 hours or next friday at 3.'
    )
  ).toBeVisible();
  saw('STL-625');

  const saving = await hold(page, reminderOf(ids.Agenda), method('PUT'));
  await choose();
  await expect(menu.getByRole('status')).toHaveText('Saving…');
  await expect(when).toBeDisabled();
  await expect(tomorrow).toBeDisabled();
  await expect(cancel).toBeDisabled();
  await expect(menu.getByRole('radio', { name: 'If no reply' })).toBeDisabled();
  saw('STL-626');
  await saving.release();
  await expect(menu).toHaveCount(0);
  await expectReminder(mailbox, ids.Agenda);

  await open(ids.Minutes, 'Minutes');
  await choose();
  await expect(menu.getByRole('alert')).toHaveText(
    'Couldn’t confirm the change. Your time is still here; retrying this request is safe.'
  );
  await expect(when).toHaveValue('tomorrow 9am');
  saw('STL-627');
  await press(cancel);
  await expect(menu).toHaveCount(0);

  await open(ids.Budget, 'Budget');
  await choose();
  await expect(menu.getByRole('alert')).toHaveText(
    'The reminder was not set. The conversation has been restored.'
  );
  saw('STL-103');
  await press(cancel);
  await expect(menu).toHaveCount(0);

  await open(ids.Lunch, 'Lunch');
  await expect(menu.getByRole('alert')).toHaveText(
    'Couldn’t load this email reminder.'
  );
  const retry = menu.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeVisible();
  const first = menu.getByRole('option').first();
  await expect(first).toBeDisabled();
  saw('STL-628');
  shared.readable();
  await press(retry);
  await expect(menu.getByRole('alert')).toHaveCount(0);
  await expect(first).toBeEnabled();
}

test.describe('the Remind me menu on a desktop', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, the menu shows nothing (or the wrong words) for text
  // that is not a time; stays usable while a reminder saves, so a second
  // one can be sent; or says nothing when the save is refused, when the
  // server answers that the reminder was not set, or when the thread's
  // reminder cannot be read (and Retry does not read it again).
  test('typed text that is no time, saving, and the alerts of a refused or unread reminder', async ({
    page,
    mailbox,
  }) => {
    const ids = (await deliverAll(mailbox, [...SUBJECTS])) as Ids;
    const shared = await faults(page, ids);
    await mailbox.open();
    await expect
      .poll(() => rowIds(page))
      .toEqual(expect.arrayContaining(Object.values(ids)));
    await menuStates(
      page,
      mailbox,
      ids,
      shared,
      async (id) => {
        await rowMenu(page, id, /^Remind me/);
        await expect(remindWhen(page)).toBeVisible();
      },
      (target) => target.click()
    );
  });
});

test.describe('the Remind me menu on a phone', () => {
  test.use({ ...PHONE, provider: 'OUTLOOK' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, the phone's menu shows nothing (or the wrong words)
  // for text that is not a time; stays usable while a reminder saves; or
  // says nothing when the save is refused, when the server answers that
  // the reminder was not set, or when the thread's reminder cannot be read
  // (and Retry does not read it again).
  test('typed text that is no time, saving, and the alerts of a refused or unread reminder', async ({
    page,
    mailbox,
  }) => {
    const ids = (await deliverAll(mailbox, [...SUBJECTS])) as Ids;
    const shared = await faults(page, ids);
    await menuStates(
      page,
      mailbox,
      ids,
      shared,
      async (id, subject) => {
        await mailbox.open(`/app/email/${id}`);
        await expect(page.getByText(`About ${subject}.`).first()).toBeVisible();
        expect(await page.evaluate(() => window.innerWidth)).toBe(
          PHONE.viewport.width
        );
        await phoneHeaderSubject(page, subject).tap();
        const sheet = page.getByRole('dialog', { name: 'File actions' });
        await sheetIn(sheet);
        await sheet
          .getByRole('button', { name: 'Remind me', exact: true })
          .tap();
        await sheetIn(remindMenu(page));
      },
      (target) => target.tap()
    );
  });
});
