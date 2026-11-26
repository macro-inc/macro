// The notices of files in an open thread: a reply's file whose upload is
// left unfinished and one whose removal is refused, a received file whose
// download or opening fails, and a forward whose files cannot be added or
// taken off.

import type { Page } from '@playwright/test';
import { attach, loadAppSteadily, relayUploads } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { messageAction, notice, replyEditor } from './harness/send';
import { hasDraft } from './harness/ways-compose2';
import { saw } from './ledger/record';

const FROM = 'Grace <grace@example.com>';
const file = (name: string) => ({
  name,
  mimeType: 'text/plain',
  buffer: Buffer.from(`The contents of ${name}.`),
});
const received = (name: string) => ({
  filename: name,
  mimeType: 'text/plain',
  base64: Buffer.from(`The contents of ${name}.`).toString('base64'),
});

/** Answers 500 to the requests of `method` to a path matching `path`
 * while `failing()` answers true. */
async function refuse(
  page: Page,
  method: string,
  path: RegExp,
  failing: () => boolean = () => true
): Promise<void> {
  await page.route(path, (route) => {
    if (route.request().method() !== method || !failing())
      return route.fallback();
    return route.fulfill({ status: 500, body: '{}' });
  });
}

/** Resolves once a request of `method` to a path matching `path` is
 * answered with success. */
async function answered(
  page: Page,
  method: string,
  path: RegExp
): Promise<void> {
  await page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      path.test(new URL(response.url()).pathname) &&
      response.ok()
  );
}

/**
 * Watches the draft files stored from now on: `stored(name)` resolves once
 * the upload of the file `name` added to a draft has completed with success.
 * A save uploads every file still unstored, one after another, so the first
 * completed upload need not be that file's.
 */
function watchStored(page: Page): (name: string) => Promise<void> {
  const created = new Map<string, string>();
  const completed = new Set<string>();
  page.on('response', async (response) => {
    const request = response.request();
    const path = new URL(response.url()).pathname;
    if (request.method() !== 'POST' || !response.ok()) return;
    const done = path.match(/\/attachments\/([^/]+)\/complete$/);
    if (done) completed.add(done[1]);
    if (!/\/drafts\/[^/]+\/attachments$/.test(path)) return;
    const { file_name } = JSON.parse(request.postData() ?? '{}') as {
      file_name?: string;
    };
    // The page may close before the body is read.
    const body = (await response.json().catch(() => ({}))) as {
      attachment_id?: string;
    };
    if (file_name && body.attachment_id)
      created.set(file_name, body.attachment_id);
  });
  return (name) =>
    expect
      .poll(() => {
        const id = created.get(name);
        return id !== undefined && completed.has(id);
      })
      .toBe(true);
}

/** Delivers a message and opens its thread by its address. */
async function openDelivered(
  page: Page,
  mailbox: Mailbox,
  subject: string,
  attachments: ReturnType<typeof received>[] = []
): Promise<string> {
  await mailbox.deliver({
    from: FROM,
    subject,
    text: `About ${subject}.`,
    attachments,
  });
  const { id } = await mailbox.synced(subject);
  await mailbox.open(`/app/mail/${id}`);
  await expect(page.getByText(`About ${subject}.`).first()).toBeVisible();
  return id;
}

// The files go to Macro's own email service, which stores and answers them
// the same way whichever mailbox the thread is in. Gmail only.
test.describe('the notices of files in an open thread', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, a reply's file whose upload the service never
  // completes is not reported (neither as unfinished nor as unsaved), or a
  // refused removal of a reply's file says nothing.
  test("a reply's file left unfinished, then one whose removal is refused", async ({
    page,
    mailbox,
  }) => {
    await relayUploads(page);
    const id = await openDelivered(page, mailbox, 'Trail');
    await messageAction(page, 'About Trail.', 'reply');
    await replyEditor(page).click();
    await replyEditor(page).pressSequentially('Notes attached.');
    await expect.poll(() => hasDraft(mailbox, id)).toBe(true);

    let completing = false;
    await refuse(
      page,
      'POST',
      /\/email\/drafts\/[^/]+\/attachments\/[^/]+\/complete/,
      () => !completing
    );
    await attach(page, file('notes.txt'));
    await expect(
      notice(
        page,
        'Attachment upload is unfinished. Retry the upload or remove the file.'
      )
    ).toBeVisible();
    saw('STL-505');
    await expect(notice(page, 'Failed to save attachments')).toBeVisible();
    saw('STL-506');

    // A file taken off before its upload is stored only leaves the
    // composer; one stored is taken off the draft too.
    completing = true;
    const stored = watchStored(page);
    await attach(page, file('route.txt'));
    await stored('route.txt');
    const remove = page.getByRole('button', { name: 'Remove route.txt' });
    await refuse(
      page,
      'DELETE',
      /\/email\/drafts\/[^/]+\/attachments\/[^/?]+(\?|$)/
    );
    await remove.click();
    await expect(
      notice(page, 'Failed to remove draft attachment')
    ).toBeVisible();
    saw('STL-507');
  });

  // When this fails, a received file whose download fails, or whose
  // document cannot be made to open it, says nothing; or a forward's file
  // whose removal is refused, or a forward whose files cannot be added,
  // says nothing.
  test('a received file: download and opening refused, then its forward refused', async ({
    page,
    mailbox,
  }) => {
    await refuse(page, 'GET', /\/email\/attachments\/[^/?]+(\?|$)/);
    await refuse(page, 'GET', /\/email\/attachments\/[^/]+\/document_id/);
    await openDelivered(page, mailbox, 'Lunch?', [received('menu.txt')]);

    await page.getByRole('button', { name: 'Download menu.txt' }).click();
    await expect(notice(page, 'Download failed')).toBeVisible();
    saw('STL-092');
    await page.getByRole('button', { name: 'menu.txt', exact: true }).click();
    await expect(notice(page, 'Attachment unavailable')).toBeVisible();
    saw('STL-093');

    // The forward's file is added to its draft once the draft is saved.
    const added = answered(
      page,
      'POST',
      /\/drafts\/[^/]+\/forwarded-attachments(\?|$)/
    );
    await messageAction(page, 'About Lunch?.', 'forward');
    await replyEditor(page).click();
    await replyEditor(page).pressSequentially('FYI');
    await added;
    const remove = page.getByRole('button', { name: 'Remove menu.txt' });
    await refuse(
      page,
      'DELETE',
      /\/email\/drafts\/[^/]+\/forwarded-attachments\/[^/?]+(\?|$)/
    );
    await remove.click();
    await expect(
      notice(page, 'Failed to remove forwarded attachment')
    ).toBeVisible();
    saw('STL-509', 'F-123');

    await refuse(
      page,
      'POST',
      /\/email\/drafts\/[^/]+\/forwarded-attachments(\?|$)/
    );
    await openDelivered(page, mailbox, 'Dinner?', [received('wine.txt')]);
    await messageAction(page, 'About Dinner?.', 'forward');
    await replyEditor(page).click();
    await replyEditor(page).pressSequentially('FYI');
    await expect(
      notice(page, 'Failed to add forwarded attachments')
    ).toBeVisible();
    saw('STL-508');
  });
});
