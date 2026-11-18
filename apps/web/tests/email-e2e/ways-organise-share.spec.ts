// The ways to share a thread, copy where it is, step to the next one and
// start a task or an event from it, besides the header buttons other specs
// drive: the row's context menu, the menu after the open thread's subject,
// Cmd+S and the header's arrows.
//
// Gmail only: none of these asks the mailbox anything. Sharing is the
// storage service's, the copies and the arrows are the screen's, and the
// composers open filled from the thread on the screen.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { openThreadId, rowIds } from './harness/list';
import { answerSharingAsUser, grantView } from './harness/sharing';
import {
  deliverAll,
  openFromList,
  rowMenu,
  titleMenu,
} from './harness/ways-organise';
import {
  expectClipboard,
  expectShareDialog,
  shareDialog,
} from './harness/ways-organise-more';
import { keyboardInThread } from './harness/ways-thread-more';
import { did } from './ledger/record';

test.use({ provider: 'GMAIL' });
test.beforeEach(({ page }) => loadAppSteadily(page));

// When this fails, Share in a row's menu opens no Share dialog, one that
// closes at once (the menu's own dismissal reaching it), or one that does
// not list the person the thread is shared with.
test("Share in a row's menu opens the thread's Share dialog", async ({
  page,
  mailbox,
}) => {
  const ids = await deliverAll(mailbox, ['Agenda']);
  const bob = await mailbox.stack.user('bob@example.com');
  await grantView(mailbox, ids.Agenda, bob);
  await answerSharingAsUser(page, mailbox);

  await mailbox.open();
  await expect.poll(() => rowIds(page)).toEqual([ids.Agenda]);
  await rowMenu(page, ids.Agenda, /^Share/);
  did('AL-085');
  await expectShareDialog(page, 'Agenda', 'bob@example.com');
});

// When this fails, Share in the menu after an open thread's subject, or
// Cmd+S in the open thread, opens no Share dialog, or one that does not list
// the person the thread is shared with.
test("the ways to open an open thread's Share dialog", async ({
  page,
  mailbox,
}) => {
  const ids = await deliverAll(mailbox, ['Minutes']);
  const bob = await mailbox.stack.user('bob@example.com');
  await grantView(mailbox, ids.Minutes, bob);
  await answerSharingAsUser(page, mailbox);
  // The dialog opens with the keyboard in its To field, which keeps Escape.
  const closed = async (subject: string) => {
    const dialog = shareDialog(page, subject);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
  };

  await mailbox.open();
  await expect
    .poll(() => rowIds(page))
    .toEqual(expect.arrayContaining(Object.values(ids)));
  await openFromList(page, ids.Minutes, 'About Minutes.');
  await titleMenu(page, 'Minutes', /^Share/);
  did('AL-149');
  await expectShareDialog(page, 'Minutes', 'bob@example.com');
  await closed('Minutes');

  await keyboardInThread(page, 'Minutes');
  await page.keyboard.press('ControlOrMeta+s');
  did('AL-612');
  await expectShareDialog(page, 'Minutes', 'bob@example.com');
});

// When this fails, Copy Link or Copy ID in the menu after an open thread's
// subject leaves the clipboard without the thread's address or its id.
test("the menu after the subject copies the thread's link and its id", async ({
  page,
  mailbox,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const ids = await deliverAll(mailbox, ['Agenda']);

  await mailbox.open();
  await openFromList(page, ids.Agenda, 'About Agenda.');
  await titleMenu(page, 'Agenda', /^Copy Link/);
  did('AL-616');
  await expectClipboard(page, `${mailbox.front.origin}/app/mail/${ids.Agenda}`);
  // A copy item keeps the menu open: Copy ID is picked from the same menu.
  await page
    .getByRole('menu')
    .getByRole('menuitem', { name: /^Copy ID/ })
    .click();
  did('AL-617');
  await expectClipboard(page, ids.Agenda);
});

// When this fails, the open thread's Next item or Previous item opens
// another thread than the one below or above it in the list.
test("the header's arrows open the thread below, and the one above", async ({
  page,
  mailbox,
}) => {
  const ids = await deliverAll(mailbox, ['Agenda', 'Minutes', 'Budget']);
  const navigation = page.getByRole('group', { name: 'Item navigation' });

  await mailbox.open();
  await expect
    .poll(() => rowIds(page))
    .toEqual(expect.arrayContaining(Object.values(ids)));
  const [top, middle, bottom] = await rowIds(page);
  const body = (id: string) =>
    `About ${Object.keys(ids).find((subject) => ids[subject] === id)}.`;
  await openFromList(page, middle, body(middle));
  await navigation.getByRole('button', { name: 'Next item' }).click();
  did('AL-125');
  await expect.poll(() => openThreadId(page)).toBe(bottom);
  await expect(page.getByText(body(bottom))).toBeVisible();
  await navigation.getByRole('button', { name: 'Previous item' }).click();
  did('AL-125');
  await expect.poll(() => openThreadId(page)).toBe(middle);
  await navigation.getByRole('button', { name: 'Previous item' }).click();
  await expect.poll(() => openThreadId(page)).toBe(top);
  await expect(page.getByText(body(top))).toBeVisible();
});

// When this fails, Create task or Create event in the menu after an open
// thread's subject opens no composer, or one that has lost the thread: a
// task without its source, an event without its subject or its sender.
test('the menu after the subject starts a task and an event from the thread', async ({
  page,
  mailbox,
}) => {
  // The model that would read a time from the message is not part of the
  // stack; the full-stack tier refuses it the same way.
  await page.route('**/universal_input/**', (route) =>
    route.fulfill({ status: 503 })
  );
  const ids = await deliverAll(mailbox, ['Agenda']);
  const composer = page.getByRole('dialog');

  await mailbox.open();
  await openFromList(page, ids.Agenda, 'About Agenda.');
  await titleMenu(page, 'Agenda', /^Create task/);
  did('AL-153');
  await expect(composer.getByRole('textbox', { name: 'Title' })).toBeVisible();
  await expect(
    composer.getByRole('button', { name: 'Open source Agenda' })
  ).toBeVisible();

  // The task composer keeps its draft open over the thread; the thread is
  // opened again rather than the draft thrown away.
  await mailbox.open(`/app/mail/${ids.Agenda}`);
  await expect(page.getByText('About Agenda.')).toBeVisible();
  await expect(composer).toHaveCount(0);
  await titleMenu(page, 'Agenda', /^Create event/);
  did('AL-154');
  await expect(composer.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Agenda'
  );
  // One guest is named in place of a count.
  await expect(composer.getByRole('button', { name: 'Guests' })).toHaveText(
    'grace@example.com'
  );
});
