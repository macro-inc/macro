import {
  body,
  composeNew,
  draftThreads,
  dropFile,
  loadAppSteadily,
  routeDraftId,
  watchDraftSaves,
} from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { htmlBody, onlySentRaw } from './harness/send';
import { confirmed, did, saw } from './ledger/record';

/** A 1x1 PNG. */
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test.beforeEach(({ page }) => loadAppSteadily(page));

test.describe('content the composer did not write itself', () => {
  // Class composer-foreign-html-import: when this fails, the blocks of a
  // message someone else wrote are taken for the editor's own blocks as the
  // reply quotes them (a block holding an image for an image alone, any
  // block for an embedded one), and the reply goes out with the quoted text
  // missing.
  test('a reply quotes the text around an image in the original', async ({
    page,
    mailbox,
  }) => {
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Harbour walk',
      html: `<div><div>Meet at the north gate <img src="data:image/png;base64,${PIXEL}" alt="map"> and bring boots.</div><div>Back by <b>four</b>.</div></div>`,
    });
    const thread = await mailbox.synced('Harbour walk');

    await mailbox.open(`/app/mail/${thread.id}`);
    did('AL-910');
    await page.getByText('Reply...').click();
    did('AL-171');
    await page.keyboard.type('See you there.');
    did('AC-081');
    await page.keyboard.press('ControlOrMeta+Enter');
    did('AC-311');

    const sent = htmlBody(await onlySentRaw(mailbox));
    expect(sent).toContain('See you there.');
    confirmed('F-102');
    expect(sent).toContain('Meet at the north gate');
    expect(sent).toContain('and bring boots.');
    expect(sent).toContain('four');
    confirmed('F-132');
  });

  // Class composer-foreign-html-import: when this fails, a saved draft's own
  // paragraphs are taken for another kind of block when the draft is opened
  // again, and the composer shows it empty and saves it that way.
  test('a saved draft opens again with its paragraphs and saves them', async ({
    page,
    mailbox,
  }) => {
    const saves = watchDraftSaves(page);
    await composeNew(page, mailbox, {
      to: 'bob@example.com',
      subject: 'Harbour walk',
      body: 'Meet at the north gate.',
    });
    await routeDraftId(page);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Bring boots.');
    did('AC-022');
    did('AC-911');
    await expect.poll(() => saves.at(-1)?.html ?? '').toContain('Bring boots.');
    await expect.poll(async () => (await draftThreads(mailbox)).length).toBe(1);

    await page.reload();
    await expect(body(page)).toContainText('Meet at the north gate.');
    await expect(body(page)).toContainText('Bring boots.');
    saw('STC-961');
    saw('STC-970');
    await body(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' Back by four.');
    await expect
      .poll(() => saves.at(-1)?.html ?? '')
      .toContain('Back by four.');
    expect(saves.at(-1)?.html).toContain('Meet at the north gate.');
    expect(saves.at(-1)?.html).toContain('Bring boots.');
  });

  // Class composer-inline-media: when this fails, an image dropped on the
  // message becomes an attachment chip (or a placeholder that never
  // resolves) instead of a picture in the text, and the sent message shows
  // no image where the user put it.
  test('a dropped image is sent inside the message', async ({
    page,
    mailbox,
  }) => {
    // The static file service, which the stack does not run: it names the
    // image and says where to upload it and where it will be served.
    const uploads: string[] = [];
    mailbox.front.stub(({ method, path }) => {
      if (method !== 'PUT') return undefined;
      if (path === '/static-file/api/file') {
        const location = `${mailbox.front.origin}/static-file/stored/map-1`;
        return {
          json: { id: 'map-1', upload_url: location, file_location: location },
        };
      }
      if (path === '/static-file/stored/map-1') {
        uploads.push(path);
        return { json: {} };
      }
      return undefined;
    });
    await composeNew(page, mailbox, {
      to: 'bob@example.com',
      subject: 'Harbour walk',
      body: 'The map:',
    });
    await routeDraftId(page);

    await dropFile(body(page), {
      name: 'map.png',
      mimeType: 'image/png',
      base64: PIXEL,
    });
    did('AC-026', 'F-105');
    await expect(body(page).locator('img')).toHaveCount(1);
    saw('STC-936');
    await expect.poll(() => uploads).toHaveLength(1);
    await page.getByRole('button', { name: 'Send email' }).click();
    did('AC-057');

    const raw = await onlySentRaw(mailbox);
    const html = htmlBody(raw);
    expect(html).toMatch(/<img[^>]+src="(cid:|https?:)/);
    expect(html).not.toContain('blob:');
    confirmed('F-105');
    confirmed('F-131');
  });
});
