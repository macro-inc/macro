// What the composer says when its draft is scheduled, sent or deleted from
// another tab while it holds newer text the service has not taken yet: it
// keeps that text as a new draft, and says which saved files the new draft
// lacks.
//
// Gmail only: the draft's lifecycle and these notices are the same client
// code for either provider.

import type { Locator, Page } from '@playwright/test';
import { attach, loadAppSteadily, relayUploads } from './harness/drafts';
import {
  expect,
  type Mailbox,
  type ThreadPreview,
  test,
} from './harness/fixtures';
import { notice, threadMessages } from './harness/send';
import {
  anotherDevice,
  backfilled,
  deleteElsewhere,
  failRequestsLater,
  holdOperation,
  holdRequests,
  makeDue,
  replyBody,
  returnToTab,
  savedDraft,
  savedNew,
  savedReply,
  scheduleElsewhere,
  sentFromMacro,
} from './harness/states-send2';
import { morningIn } from './harness/ways-send';
import { saw } from './ledger/record';

/** The newer text each test types. */
const NEWER = 'And more.';

/** The composer's read of what became of its draft, through its thread. */
const DRAFT_READ = /\/email\/email\/threads\/[0-9a-f-]{36}\?/;

/**
 * `savedNew`, once the composer's first read of the new draft has answered.
 * It reads as soon as the service takes the draft; a read still on its way
 * when the page is shown again answers for that too, with the draft as it
 * was.
 */
async function savedNewRead(
  page: Page,
  mailbox: Mailbox,
  subject: string
): Promise<string> {
  const read = page.waitForResponse((response) =>
    DRAFT_READ.test(response.url())
  );
  const draft = await savedNew(page, mailbox, subject);
  await read;
  return draft;
}

type SlowStorage = Window & { confirmWrites?: () => void };

/**
 * Holds back this device's word that it stored a draft, as a slow disk
 * does: no write to the drafts' storage on this device confirms until the
 * function given back is called.
 */
async function slowDraftStorage(page: Page): Promise<() => Promise<void>> {
  await page.evaluate(() => {
    const own = Object.getOwnPropertyDescriptor(
      IDBTransaction.prototype,
      'oncomplete'
    );
    const get = own?.get;
    const set = own?.set;
    if (!own || !get || !set) throw new Error('oncomplete is not a property');
    const held: (() => void)[] = [];
    let holding = true;
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
      configurable: true,
      enumerable: own.enumerable,
      get(this: IDBTransaction) {
        return get.call(this);
      },
      set(this: IDBTransaction, handler: unknown) {
        if (
          typeof handler !== 'function' ||
          this.mode !== 'readwrite' ||
          this.db.name !== 'macro-email-working-copies-v1'
        )
          return set.call(this, handler);
        set.call(this, (event: Event) => {
          const confirm = () => handler.call(this, event);
          if (holding) held.push(confirm);
          else confirm();
        });
      },
    });
    (window as SlowStorage).confirmWrites = () => {
      holding = false;
      Object.defineProperty(IDBTransaction.prototype, 'oncomplete', own);
      for (const confirm of held.splice(0)) confirm();
    };
  });
  return async () => {
    await page.evaluate(() => (window as SlowStorage).confirmWrites?.());
  };
}

/**
 * Lets `elsewhere` change the draft, then types newer text while the
 * composer's read of its draft is on its way: held before the service sees
 * it, the read answers with what the other tab did, before the composer has
 * saved the text. This device's storage is slow to confirm the text
 * meanwhile: once it confirms text the service has not taken, the composer
 * stops reading its draft (handoff deleted-draft-sometimes-saved-silently).
 * Gives what lets the storage confirm again.
 */
async function typeAfter(
  page: Page,
  elsewhere: () => Promise<void>
): Promise<() => Promise<void>> {
  const reading = await holdRequests(page, DRAFT_READ);
  await elsewhere();
  await returnToTab(page);
  await reading.arrived;
  const confirmWrites = await slowDraftStorage(page);
  await page.keyboard.type(` ${NEWER}`);
  await reading.release();
  return confirmWrites;
}

test.use({ provider: 'GMAIL' });
// The end of the inbox's backfill mounts an open composer again, which
// drops the caret and what it was about to read.
test.beforeEach(async ({ page, mailbox }) => {
  await loadAppSteadily(page);
  await backfilled(mailbox);
});

// When this fails, newer text in a composer is lost, or kept without a
// word, when its draft is scheduled from another tab.
test('newer text is kept as a new draft when its draft is scheduled elsewhere', async ({
  page,
  mailbox,
}) => {
  const draft = await savedNewRead(page, mailbox, 'Quarter close');
  const confirmWrites = await typeAfter(page, () =>
    scheduleElsewhere(mailbox, draft, morningIn(1))
  );
  await expect(
    notice(
      page,
      'This email was scheduled in another tab. Your newer text was kept as a new draft.'
    )
  ).toBeVisible();
  saw('STC-074');
  await confirmWrites();
  await expect
    .poll(() => savedDraft(mailbox, { subject: 'Quarter close' }, NEWER))
    .toBeTruthy();
});

// When this fails, newer text in a composer whose draft another device sent
// is dropped without a word: the save of that text is refused as already
// sent, and the composer clears itself instead of keeping the text.
test('newer text is kept as a new draft when its draft is sent elsewhere', async ({
  page,
  mailbox,
}) => {
  // Sent by another device's schedule before the composer reads it, so the
  // composer never sees it scheduled.
  const draft = await savedNewRead(page, mailbox, 'Last numbers');
  const confirmWrites = await typeAfter(page, async () => {
    await scheduleElsewhere(mailbox, draft, morningIn(1));
    await makeDue(mailbox, draft);
    await mailbox.stack.runScheduledSweep();
    await expect.poll(() => sentFromMacro(mailbox, 'Last numbers')).toBe(true);
  });
  // The composer reads what was sent beside this device's working copies,
  // which wait for its held writes.
  await confirmWrites();
  await expect(
    notice(
      page,
      'This email was already sent. Your newer text was kept as a new draft and was not sent.'
    )
  ).toBeVisible();
  saw('STC-411', 'F-120');
  await expect
    .poll(() => savedDraft(mailbox, { subject: 'Last numbers' }, NEWER))
    .toBeTruthy();
});

// When this fails, a composer whose save the service refuses because
// another device's schedule already sent the draft clears itself without a
// word.
test('a save refused because the scheduled email went out says the composer was updated', async ({
  page,
  mailbox,
}) => {
  const failReads = await failRequestsLater(page, DRAFT_READ);
  const draft = await savedNew(page, mailbox, 'Final numbers');
  // The composer's reads of its draft fail from here on, so it learns of the
  // send only from the refused save. Its timer, focus or a relayed change
  // would otherwise read the draft as scheduled or sent first now and then,
  // and no save is refused. A read already let through as the draft is saved
  // is answered before the schedule below: answered after it, it reads the
  // draft as scheduled or sent, and again no save is refused.
  await failReads();
  await scheduleElsewhere(mailbox, draft, morningIn(1));
  await makeDue(mailbox, draft);
  await mailbox.stack.runScheduledSweep();
  await expect.poll(() => sentFromMacro(mailbox, 'Final numbers')).toBe(true);
  await page.keyboard.type(` ${NEWER}`);
  await expect(
    page.getByText(
      'This scheduled email was sent. Your composer has been updated.'
    )
  ).toBeVisible();
  saw('STC-076');
});

/**
 * A reply holding a file Macro stores, opened again so the file is the
 * saved draft's, with the caret in its body. Gives the chip of the file.
 */
async function replyWithFile(
  page: Page,
  mailbox: Mailbox,
  subject: string,
  reopen = true
): Promise<{ thread: ThreadPreview; draftId: string; file: Locator }> {
  await relayUploads(page);
  const { thread, draftId } = await savedReply(page, mailbox, subject);
  const stored = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/attachments\/[^/]+\/complete$/.test(
        new URL(response.url()).pathname
      ) &&
      response.ok()
  );
  await attach(page, {
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('The notes.'),
  });
  await stored;
  if (reopen) await mailbox.open(`/app/mail/${thread.id}`);
  const file = page.getByRole('button', { name: 'Remove notes.txt' });
  await expect(file).toBeVisible();
  await replyBody(page).click();
  return { thread, draftId, file };
}

// When this fails, newer text in a reply is lost, or kept without a word,
// when its draft is deleted in another tab, or the user is not told to
// attach again the saved files the new draft lacks.
test('newer text in a reply is kept as a new draft, without its saved files, when its draft is deleted elsewhere', async ({
  page,
  mailbox,
}) => {
  const { thread, draftId, file } = await replyWithFile(
    page,
    mailbox,
    'Spare notes'
  );
  const confirmWrites = await typeAfter(page, () =>
    deleteElsewhere(mailbox, draftId)
  );
  await expect(
    notice(
      page,
      'The draft changed elsewhere. Your newer text was kept as a new draft.'
    )
  ).toBeVisible();
  saw('STC-409');
  await expect(
    notice(
      page,
      'Previously saved attachments could not be copied to the new draft. Please attach those files again.'
    )
  ).toBeVisible();
  await expect(file).toHaveCount(0);
  saw('STC-080');
  await confirmWrites();
  await expect
    .poll(() => savedDraft(mailbox, { threadId: thread.id }, NEWER))
    .toBeTruthy();
});

// The stale save can reach the service before the next lifecycle read. On
// another device the reply has only the saved file reference. The original
// composer still has its bytes and can upload them again.
for (const scenario of [
  {
    title:
      'newer text in a reply waiting to be saved is kept as a new draft, without its saved files, when its draft is deleted elsewhere',
    remoteOnly: true,
    files: 0,
  },
  {
    title: 'a replacement reply uploads the file it still has on this device',
    remoteOnly: false,
    files: 1,
  },
]) {
  test(scenario.title, async ({ page: original, mailbox, browser }) => {
    const {
      thread,
      draftId,
      file: originalFile,
    } = await replyWithFile(original, mailbox, 'Spare pages', false);
    const other = scenario.remoteOnly
      ? await anotherDevice(browser, mailbox)
      : undefined;
    const page = other?.page ?? original;
    const threadUrl = `${mailbox.front.origin}/app/mail/${thread.id}`;
    const file = other
      ? page.getByRole('button', { name: 'Remove notes.txt' })
      : originalFile;
    try {
      if (other) {
        await page.goto(threadUrl);
        await expect(file).toBeVisible();
        await replyBody(page).click();
      }

      const saving = await holdOperation(page, 'SaveEmailDraft');
      await page.keyboard.type(` ${NEWER}`);
      await saving.arrived;
      const reading = await holdRequests(page, DRAFT_READ);
      try {
        await deleteElsewhere(mailbox, draftId);
        await returnToTab(page);
        await saving.release();
        await expect(
          notice(
            page,
            'The draft changed elsewhere. Your newer text was kept as a new draft.'
          )
        ).toBeVisible();
        saw('STC-409');
        if (scenario.remoteOnly) {
          await expect(
            notice(
              page,
              'Previously saved attachments could not be copied to the new draft. Please attach those files again.'
            )
          ).toBeVisible();
          saw('STC-080');
        }
        await expect(file).toHaveCount(scenario.files);
        await expect
          .poll(async () => {
            const replacement = await savedDraft(
              mailbox,
              { threadId: thread.id },
              NEWER
            );
            const drafts = (await threadMessages(mailbox, thread.id)).filter(
              (message) => message.is_draft
            );
            return drafts.map((message) => ({
              replacement:
                message.db_id === replacement && message.db_id !== draftId,
              files: message.attachments_draft?.length ?? 0,
            }));
          })
          .toEqual([{ replacement: true, files: scenario.files }]);
      } finally {
        await reading.release();
      }

      await page.goto(threadUrl);
      await expect(replyBody(page)).toContainText(NEWER);
      await expect(file).toHaveCount(scenario.files);
    } finally {
      await other?.close();
    }
  });
}
