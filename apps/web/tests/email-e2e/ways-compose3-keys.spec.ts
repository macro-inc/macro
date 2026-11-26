// The new-email composer's own keys on a desktop: the shortcuts into the
// subject and the message, Escape out of the subject, Send and Schedule with
// cmd+enter, the three discard shortcuts, the attach shortcut, and b for an
// event made from the draft.

import type { Page } from '@playwright/test';
import {
  body,
  composeNew,
  draftThreads,
  loadAppSteadily,
  relayUploads,
  routeDraftId,
} from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { sentMessages } from './harness/send';
import { openComposer, sentCopy } from './harness/ways-compose1';
import { send } from './harness/ways-compose2';
import {
  clock,
  morningIn,
  openPicker,
  preset,
  scheduledNotice,
  scheduledTimes,
} from './harness/ways-send';
import { did } from './ledger/record';

const GRACE = 'grace@example.com';

test.beforeEach(async ({ page }) => {
  await loadAppSteadily(page);
  await relayUploads(page);
});

function subjectField(page: Page) {
  return page.getByRole('textbox', { name: 'Subject' });
}

/** Opens a new email and waits until the service holds it as a draft. */
async function storedNew(page: Page, mailbox: Mailbox, subject: string) {
  await composeNew(page, mailbox, { to: GRACE, subject, body: 'Never mind.' });
  await routeDraftId(page);
  await expect
    .poll(async () => (await draftThreads(mailbox)).map((d) => d.name), {
      message: `"${subject}" was never stored as a draft`,
    })
    .toEqual([subject]);
}

for (const provider of ['GMAIL', 'OUTLOOK'] as const) {
  test.describe(`the keys of a new email in ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });

    // When this fails, shift+cmd+m or shift+cmd+s no longer moves the caret
    // into the message or the subject (what is typed next lands elsewhere),
    // or cmd+enter does not send: the provider never gets the message with
    // that subject and text.
    test('shift+cmd+m and shift+cmd+s move into the message and the subject, and cmd+enter sends them', async ({
      page,
      mailbox,
    }) => {
      const to = await openComposer(page, mailbox);
      await to.fill(GRACE);
      await to.press('Enter');

      await page.keyboard.press('Shift+ControlOrMeta+KeyM');
      did('AC-017');
      await expect(body(page)).toBeFocused();
      await page.keyboard.type('Typed after the message shortcut.');

      await page.keyboard.press('Shift+ControlOrMeta+KeyS');
      did('AC-016');
      await expect(subjectField(page)).toBeFocused();
      await page.keyboard.type('Keyboard only');
      await expect(body(page)).toContainText(
        'Typed after the message shortcut.'
      );

      await page.keyboard.press('ControlOrMeta+Enter');
      did('AC-306', 'F-131');
      const sent = await sentCopy(mailbox, 'Keyboard only');
      expect(sent.to).toEqual([GRACE]);
      expect(sent.html).toContain('Typed after the message shortcut.');
    });

    // When this fails, one of the three shortcuts that discard a new email
    // no longer does: the composer keeps the draft, or empties while the
    // email service keeps it, which is then still listed under Drafts.
    test('each discard shortcut empties the new email and removes its stored draft', async ({
      page,
      mailbox,
    }) => {
      for (const key of ['Period', 'Comma', 'KeyD']) {
        await test.step(key, async () => {
          const subject = `Discard by ${key}`;
          await storedNew(page, mailbox, subject);
          await expect(body(page)).toBeFocused();

          await page.keyboard.press(`Shift+ControlOrMeta+${key}`);
          did('AC-305', 'F-119');
          // Opened from its own address, the composer has nowhere to go
          // back to: it starts over, empty.
          await expect(subjectField(page)).toHaveValue('');
          await expect(page.getByText('Never mind.')).toHaveCount(0);
          await expect
            .poll(() => draftThreads(mailbox), {
              message: `the draft outlived the ${key} shortcut`,
            })
            .toEqual([]);
        });
      }
    });

    // When this fails, shift+cmd+u in a new email opens no file picker, or
    // the file chosen in it does not go out with the message the provider
    // sends.
    test('shift+cmd+u opens the file picker and the chosen file is sent with the new email', async ({
      page,
      mailbox,
    }) => {
      const subject = 'Attached by keyboard';
      await composeNew(page, mailbox, {
        to: GRACE,
        subject,
        body: 'The agenda is attached.',
      });
      await routeDraftId(page);
      const chooser = page.waitForEvent('filechooser');
      await page.keyboard.press('Shift+ControlOrMeta+KeyU');
      await (await chooser).setFiles({
        name: 'agenda.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('nine sharp'),
      });
      did('AC-304', 'F-122');
      await expect(
        page.getByRole('button', { name: 'Remove agenda.txt' })
      ).toBeVisible();
      await send(page);

      const sent = await sentCopy(mailbox, subject);
      expect(sent.attachments).toEqual(['agenda.txt']);
    });
  });
}

// Gmail only: the send time is held by Macro, whatever the mailbox.
// When this fails, cmd+enter on a new email with a chosen send time sends it
// at once (or does nothing) instead of holding it for that time.
test('cmd+enter on a new email with a send time holds it for that time', async ({
  page,
  mailbox,
}) => {
  await composeNew(page, mailbox, {
    to: GRACE,
    subject: 'Held by keyboard',
    body: 'For tomorrow morning.',
  });
  await openPicker(page, clock(page));
  await preset(page, 'Tomorrow').click();
  await expect(
    page.getByRole('status').filter({ hasText: /^Scheduled send: / })
  ).toBeVisible();
  await body(page).click();

  await page.keyboard.press('ControlOrMeta+Enter');
  did('AC-306', 'F-142');
  await expect(scheduledNotice(page)).toBeVisible();
  await expect
    .poll(() => scheduledTimes(mailbox), {
      message: 'cmd+enter did not hold the message for tomorrow morning',
    })
    .toEqual([morningIn(1).toString()]);
  expect(await sentMessages(mailbox)).toEqual([]);
});

// Gmail only: the event composer is filled from the draft on the screen.
// When this fails, Escape no longer takes the caret out of the subject (the
// next key is typed into it), or b with the caret outside the text opens no
// event composer, or one without the draft's subject or its recipient.
test('Escape leaves the subject, and b then opens an event with the subject and the recipient', async ({
  page,
  mailbox,
}) => {
  // The model that would refine the event is not part of the stack.
  await page.route('**/universal_input/**', (route) =>
    route.fulfill({ status: 503 })
  );
  const to = await openComposer(page, mailbox);
  await to.fill(GRACE);
  await to.press('Enter');
  const subject = subjectField(page);
  await subject.click();
  await page.keyboard.type('Harbour lunch');
  await expect(subject).toBeFocused();

  await page.keyboard.press('Escape');
  did('AC-019', 'F-101');
  await expect(subject).not.toBeFocused();
  await expect(subject).toHaveValue('Harbour lunch');

  await page.keyboard.press('b');
  did('AC-307', 'F-114');
  // The title is the subject as it was: the b was not typed into it.
  const composer = page.getByRole('dialog');
  await expect(composer.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Harbour lunch'
  );
  await expect(composer.getByRole('button', { name: 'Guests' })).toHaveText(
    GRACE
  );
});
