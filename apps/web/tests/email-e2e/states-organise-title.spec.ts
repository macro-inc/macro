// What the menu after a thread's subject, and the subject itself, show:
// Delete's notices and the thread closing, the touch sheet the menu becomes
// on a phone, Copy subject, and the rest of a long subject.
//
// The notices answer the app's own request to the email service, which
// refuses the same way whichever mailbox the thread is in; what the mailbox
// then holds is organise-state's concern. Gmail on the desktop, Outlook on
// the phone, so each mailbox shows them once. Copy subject reads only the
// subject Macro holds, the same whichever mailbox: Gmail on the desktop,
// Outlook on the phone.

import type { Locator } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { trashFolder } from './harness/journeys';
import { openThreadId, rowIds } from './harness/list';
import { notice } from './harness/send';
import { refuseOperation } from './harness/states-list';
import {
  deliverWithoutSubject,
  noticesGone,
  sheetIn,
} from './harness/states-organise';
import { PHONE } from './harness/ways-list1';
import {
  deliverAll,
  held,
  openFromList,
  row,
  titleMenu,
} from './harness/ways-organise';
import { openedOnPhone, phoneHeaderSubject } from './harness/ways-thread-more';
import { saw } from './ledger/record';

const MAIL_LIST = /\/app\/mail(\?|$)/;
/** More than three lines of any layout's title. */
const longSubject = (first: string): string =>
  `${first} ${'of the planning meeting '.repeat(16)}and the end`;

/** How many lines of a thread's subject show, and whether its end does. */
function shownOf(title: Locator): Promise<{ lines: number; end: boolean }> {
  return title.evaluate((heading) => {
    const text = document
      .createTreeWalker(heading, NodeFilter.SHOW_TEXT)
      .nextNode();
    const box = heading.firstElementChild?.getBoundingClientRect();
    if (!(text instanceof Text) || !box) return { lines: 0, end: false };
    const range = document.createRange();
    range.selectNodeContents(text);
    // The line an ellipsis cuts is two rects.
    const lines = new Set(
      [...range.getClientRects()].map((line) => Math.round(line.bottom))
    );
    const inBox = [...lines].filter((bottom) => bottom <= box.bottom + 1);
    return { lines: inBox.length, end: inBox.length === lines.size };
  });
}

test.describe('the title menu of a thread on a desktop', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, Delete from the title menu leaves the thread open, or
  // says nothing (or offers no Undo) when it moves the thread to Trash,
  // nothing when the move is refused, or nothing when its Undo restores
  // the thread or is refused.
  test('Delete closes the thread with an Undo; a refused move and a refused Undo say so', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverAll(mailbox, ['Agenda', 'Minutes', 'Budget']);
    let refusing: 'restore' | 'trash' | undefined;
    await refuseOperation(
      page,
      'SetEmailThreadFolderStates',
      (body) => body.includes('"value":false'),
      () => refusing === 'restore'
    );
    await refuseOperation(
      page,
      'SetEmailThreadFolderStates',
      (body) => body.includes('"value":true'),
      () => refusing === 'trash'
    );
    await mailbox.open();
    await expect
      .poll(() => rowIds(page))
      .toEqual(expect.arrayContaining(Object.values(ids)));

    await openFromList(page, ids.Agenda, 'About Agenda.');
    await titleMenu(page, 'Agenda', /^Delete/);
    const moved = notice(page, 'Moved to Trash');
    await expect(moved).toBeVisible();
    const undo = moved.getByRole('button', { name: 'Undo' });
    await expect(undo).toBeVisible();
    saw('STL-078', 'F-075');
    await expect.poll(() => openThreadId(page)).toBeUndefined();
    await expect(page).toHaveURL(MAIL_LIST);
    await expect(page.getByText('About Agenda.')).toHaveCount(0);
    saw('STL-617', 'F-075');
    // A notice under the pointer stays until it is done with.
    await moved.hover();
    await undo.click();
    await expect(notice(page, 'Restored from Trash')).toBeVisible();
    saw('STL-078', 'F-083');

    await noticesGone(page);
    refusing = 'restore';
    await openFromList(page, ids.Minutes, 'About Minutes.');
    await titleMenu(page, 'Minutes', /^Delete/);
    await expect(moved).toBeVisible();
    await moved.hover();
    await undo.click();
    await expect(notice(page, 'Failed to restore from Trash')).toBeVisible();
    saw('STL-078', 'F-083');

    await noticesGone(page);
    refusing = 'trash';
    await openFromList(page, ids.Budget, 'About Budget.');
    await titleMenu(page, 'Budget', /^Delete/);
    await expect(notice(page, 'Failed to move to Trash')).toBeVisible();
    saw('STL-616');
  });

  // When this fails, Copy subject shows before the pointer reaches the
  // subject (or never shows when it does), or a thread without a subject
  // offers to copy one.
  test('Copy subject shows on hovering the subject, and not for a thread without one', async ({
    page,
    mailbox,
  }) => {
    // The Mail view puts the title menu where Copy subject would be: the
    // Home preview shows the subject with it.
    const ids = await deliverAll(mailbox, ['Agenda']);
    const untitled = await deliverWithoutSubject(mailbox, 'Nothing to name.');
    const copy = page.getByRole('button', { name: 'Copy subject' });

    await mailbox.open(`/app/home/email/${ids.Agenda}`);
    await expect(page.getByText('About Agenda.').first()).toBeVisible();
    await expect(copy).toHaveCSS('opacity', '0');
    await page.getByRole('heading', { name: 'Agenda', level: 1 }).hover();
    await expect(copy).toHaveCSS('opacity', '1');
    saw('STL-108');

    await mailbox.open(`/app/home/email/${untitled}`);
    await expect(page.getByText('Nothing to name.').first()).toBeVisible();
    const heading = page.getByRole('heading', { level: 1 }).filter({
      hasText: /no subject/i,
    });
    await heading.hover();
    await expect(copy).toHaveCount(0);
    saw('STL-108');
  });

  // When this fails, a long subject takes more than three lines above the
  // messages, its rest can't be shown or hidden again, or showing it leaves
  // the next thread's shown too.
  test('a long subject shows three lines, and the rest when asked', async ({
    page,
    mailbox,
  }) => {
    const minutes = longSubject('Minutes');
    const agenda = longSubject('Agenda');
    const ids = await deliverAll(mailbox, [minutes, agenda]);
    const title = (subject: string) =>
      page.getByRole('heading', { level: 1 }).filter({ hasText: subject });
    const showRest = page.getByRole('button', { name: 'Show full subject' });

    await mailbox.open();
    await openFromList(page, ids[minutes], `About ${minutes}.`);
    await expect(showRest).toBeVisible();
    await expect
      .poll(() => shownOf(title(minutes)))
      .toEqual({ lines: 3, end: false });
    saw('STL-997');

    await showRest.click();
    await expect
      .poll(async () => (await shownOf(title(minutes))).end)
      .toBe(true);
    await page.getByRole('button', { name: 'Show less' }).click();
    await expect
      .poll(() => shownOf(title(minutes)))
      .toEqual({ lines: 3, end: false });
    saw('STL-997');

    await showRest.click();
    await page.getByRole('button', { name: 'Previous item' }).click();
    await expect
      .poll(() => shownOf(title(agenda)))
      .toEqual({ lines: 3, end: false });
    saw('STL-997');
  });
});

test.describe('the title menu of a thread on a phone', () => {
  test.use({ ...PHONE, provider: 'OUTLOOK' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, the title menu on a phone is not a sheet along the
  // bottom of the screen or shows the desktop's key hints, or its Delete
  // says nothing (or offers no Undo), nothing when the move is refused, or
  // nothing when its Undo restores the thread or is refused.
  test('the menu is a bottom sheet without key hints; Delete and its Undo say how they went', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverAll(mailbox, ['Agenda', 'Minutes', 'Budget']);
    let refusing: 'restore' | 'trash' | undefined;
    await refuseOperation(
      page,
      'SetEmailThreadFolderStates',
      (body) => body.includes('"value":false'),
      () => refusing === 'restore'
    );
    await refuseOperation(
      page,
      'SetEmailThreadFolderStates',
      (body) => body.includes('"value":true'),
      () => refusing === 'trash'
    );

    await mailbox.open(`/app/email/${ids.Agenda}`);
    await expect(page.getByText('About Agenda.').first()).toBeVisible();
    expect(await page.evaluate(() => window.innerWidth)).toBe(
      PHONE.viewport.width
    );
    await phoneHeaderSubject(page, 'Agenda').tap();
    const sheet = page.getByRole('dialog', { name: 'File actions' });
    await sheetIn(sheet);
    const box = await sheet.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.y + box.height).toBeGreaterThan(PHONE.viewport.height - 24);
      expect(box.y).toBeGreaterThan(0);
    }
    // The desktop's menu shows each item's key after its name.
    await expect(
      sheet.getByRole('button', { name: 'Mark Done', exact: true })
    ).toHaveText('Mark Done');
    const remove = sheet.getByRole('button', { name: 'Delete', exact: true });
    await expect(remove).toHaveText('Delete');
    saw('STL-619');

    await remove.tap();
    const moved = notice(page, 'Moved to Trash');
    await expect(moved).toBeVisible();
    const undo = moved.getByRole('button', { name: 'Undo' });
    await expect(undo).toBeVisible();
    saw('STL-078', 'F-075');
    await undo.tap();
    await expect(notice(page, 'Restored from Trash')).toBeVisible();
    saw('STL-078', 'F-083');

    refusing = 'restore';
    await mailbox.open(`/app/email/${ids.Minutes}`);
    await expect(page.getByText('About Minutes.').first()).toBeVisible();
    await phoneHeaderSubject(page, 'Minutes').tap();
    await sheetIn(sheet);
    await remove.tap();
    await undo.tap();
    await expect(notice(page, 'Failed to restore from Trash')).toBeVisible();
    saw('STL-078', 'F-083');

    refusing = 'trash';
    await mailbox.open(`/app/email/${ids.Budget}`);
    await expect(page.getByText('About Budget.').first()).toBeVisible();
    await phoneHeaderSubject(page, 'Budget').tap();
    await sheetIn(sheet);
    await remove.tap();
    await expect(notice(page, 'Failed to move to Trash')).toBeVisible();
    saw('STL-616');
  });

  // When this fails, a phone's thread shows no Copy subject beside its
  // subject (a phone has no hover to reveal it), or a thread without a
  // subject offers to copy one.
  test('Copy subject shows beside the subject, and not for a thread without one', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverAll(mailbox, ['Agenda']);
    const untitled = await deliverWithoutSubject(mailbox, 'Nothing to name.');
    const copy = page.getByRole('button', { name: 'Copy subject' });

    await mailbox.open(`/app/email/${ids.Agenda}`);
    await expect(page.getByText('About Agenda.').first()).toBeVisible();
    await expect(copy).toBeVisible();
    await expect(copy).toHaveCSS('opacity', '1');
    saw('STL-108');

    await mailbox.open(`/app/email/${untitled}`);
    await expect(page.getByText('Nothing to name.').first()).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 1 }).filter({ hasText: /no subject/i })
    ).toBeVisible();
    await expect(copy).toHaveCount(0);
    saw('STL-108');
  });

  // When this fails, a phone's thread shows more than three lines of a long
  // subject, or its rest can't be shown.
  test('a long subject shows three lines, and the rest when asked', async ({
    page,
    mailbox,
  }) => {
    const minutes = longSubject('Minutes');
    const ids = await deliverAll(mailbox, [minutes]);
    const title = page
      .getByRole('heading', { level: 1 })
      .filter({ hasText: minutes });

    await mailbox.open(`/app/email/${ids[minutes]}`);
    const showRest = page.getByRole('button', { name: 'Show full subject' });
    await expect(showRest).toBeVisible();
    await expect.poll(() => shownOf(title)).toEqual({ lines: 3, end: false });
    await showRest.tap();
    await expect.poll(async () => (await shownOf(title)).end).toBe(true);
    saw('STL-997');
  });

  // Delete from the title menu trashes the thread and returns to the list
  // that opened the phone's email block.
  test('Delete goes back to the list', async ({ page, mailbox }) => {
    const ids = await deliverAll(mailbox, ['Agenda', 'Minutes']);
    await mailbox.open();
    await expect
      .poll(() => rowIds(page))
      .toEqual(expect.arrayContaining(Object.values(ids)));
    await row(page, ids.Agenda).tap();
    await expect(page.getByText('About Agenda.').first()).toBeVisible();
    await expect(page).toHaveURL(openedOnPhone(ids.Agenda));
    await phoneHeaderSubject(page, 'Agenda').tap();
    const sheet = page.getByRole('dialog', { name: 'File actions' });
    await sheetIn(sheet);
    await sheet.getByRole('button', { name: 'Delete', exact: true }).tap();
    await expect(notice(page, 'Moved to Trash')).toBeVisible();
    await expect
      .poll(async () => (await held(mailbox, 'Agenda'))?.labels)
      .toContain(trashFolder('OUTLOOK'));
    await expect(page).toHaveURL(MAIL_LIST);
    await expect(page.getByText('About Agenda.')).toHaveCount(0);
    await expect(row(page, ids.Minutes)).toBeVisible();
    saw('STL-617', 'F-075');
  });
});
