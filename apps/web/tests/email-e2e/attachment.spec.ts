import {
  attach,
  body,
  composeNew,
  loadAppSteadily,
  relayUploads,
  routeDraftId,
  watchDraftSaves,
} from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { onlySentRaw } from './harness/send';
import { confirmed, did, saw } from './ledger/record';

const NOTES = {
  name: 'notes.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from('bring the map'),
};

const ROUTE = {
  name: 'route.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from('north ridge, then the ford'),
};

/** A published event, as the `.ics` file a calendar exports. */
const PUBLISHED_EVENT = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Example//Calendar//EN',
  'VERSION:2.0',
  'METHOD:PUBLISH',
  'BEGIN:VEVENT',
  'DTSTART:20270114T170000Z',
  'DTEND:20270114T180000Z',
  'DTSTAMP:20261112T120000Z',
  'ORGANIZER;CN=Grace:mailto:grace@example.com',
  'UID:harbour-walk-1@example.com',
  'SUMMARY:Harbour walk',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

test.beforeEach(({ page }) => loadAppSteadily(page));

test.describe('attachments in the composer', () => {
  // Class draft-attachment-id-before-upload: when this fails, a draft saved
  // while its attachment was still uploading reserved the file a second time
  // or lost it, so the sent message carries two copies or none.
  test('a draft saved while its attachment uploads is sent with the file once', async ({
    page,
    mailbox,
  }) => {
    let release = () => {};
    await relayUploads(page, new Promise<void>((done) => (release = done)));
    const reservations: string[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        /\/drafts\/[^/]+\/attachments$/.test(new URL(request.url()).pathname)
      )
        reservations.push(request.url());
    });
    const saves = watchDraftSaves(page);

    await composeNew(page, mailbox, {
      to: 'bob@example.com',
      subject: 'Trail notes',
      body: 'Notes attached.',
    });
    await routeDraftId(page);
    await attach(page, NOTES);
    await expect(page.getByText('notes.txt')).toBeVisible();
    saw('STC-959');
    await expect.poll(() => reservations.length).toBe(1);

    // The first upload is still unanswered while a second file is attached
    // and this edit is made; the saves they ask for follow the uploads.
    await attach(page, ROUTE);
    await expect(page.getByText('route.txt')).toBeVisible();
    await body(page).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' See you there.');
    did('AC-022');
    did('AC-911');
    await expect(body(page)).toContainText('See you there.');
    saw('STC-970');
    release();
    await expect
      .poll(() => saves.some((save) => save.html.includes('See you there.')))
      .toBe(true);

    await page.getByRole('button', { name: 'Send email' }).click();
    did('AC-057');
    const raw = await onlySentRaw(mailbox);
    confirmed('F-131');
    expect(raw.match(/^Content-Disposition:\s*attachment/gim)).toHaveLength(2);
    expect(raw.match(/filename="?notes\.txt/g)).toHaveLength(1);
    expect(raw.match(/filename="?route\.txt/g)).toHaveLength(1);
    confirmed('F-122');
    expect(raw).toContain('See you there.');
    confirmed('F-102');
    expect(reservations).toHaveLength(2);
  });

  // Class attachment-upload-errors-and-pickers: when this fails, a file the
  // storage refused puts what the storage answered (raw XML with the
  // request key and signature) on screen or in the recorded console.
  test('a refused upload says so in plain words, without showing what the storage answered', async ({
    page,
    mailbox,
  }) => {
    await page.route(/\/email-attachments\//, (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/xml',
        headers: { 'access-control-allow-origin': '*' },
        body: '<?xml version="1.0" encoding="UTF-8"?><Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match the signature you provided.</Message><AWSAccessKeyId>ANOTREALKEY</AWSAccessKeyId><RequestId>4442587FB7D0A2F9</RequestId></Error>',
      })
    );
    // What the page writes to its console is recorded with the session.
    const logged: string[] = [];
    page.on('console', (message) => logged.push(message.text()));
    page.on('pageerror', (error) => logged.push(String(error)));
    const removals: string[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'DELETE' &&
        /\/drafts\/[^/]+\/attachments\//.test(new URL(request.url()).pathname)
      )
        removals.push(request.url());
    });

    await composeNew(page, mailbox, {
      to: 'bob@example.com',
      subject: 'Trail notes',
      body: 'Notes attached.',
    });
    await routeDraftId(page);
    await attach(page, NOTES);

    await expect(page.getByText('Failed to save attachments')).toBeVisible();
    saw('STC-113');
    await expect.poll(() => removals.length).toBe(1);
    const shown = await page.locator('body').innerText();
    expect(shown).not.toContain('SignatureDoesNotMatch');
    expect(shown).not.toContain('ANOTREALKEY');
    expect(shown).not.toContain('<Error>');
    expect(logged.join('\n')).not.toContain('ANOTREALKEY');
  });
});

test.describe('a calendar file attached to a message', () => {
  // Class attachment-ics-opened-as-file: when this fails, clicking a calendar
  // attachment files it into the user's documents (and opens a viewer that
  // cannot show it) instead of opening the event it describes.
  test('opens as its event and saves no document', async ({
    page,
    mailbox,
  }) => {
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Harbour walk',
      text: 'The event is attached.',
      attachments: [
        {
          filename: 'walk.ics',
          mimeType: 'text/calendar; method=PUBLISH; charset=UTF-8',
          base64: Buffer.from(PUBLISHED_EVENT).toString('base64'),
        },
      ],
    });
    const thread = await mailbox.synced('Harbour walk');
    const documentRequests: string[] = [];
    page.on('request', (request) => {
      if (/\/attachments\/[^/]+\/document_id/.test(request.url()))
        documentRequests.push(request.url());
    });

    await mailbox.open(`/app/mail/${thread.id}`);
    did('AL-910');
    await page.getByText('walk.ics').click();
    did('AL-509');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('walk.ics');
    await expect(dialog).toContainText('Harbour walk');
    saw('STL-513');
    await dialog.getByRole('button', { name: 'Close' }).click();
    did('AL-511');
    await expect(dialog).toBeHidden();
    expect(documentRequests).toEqual([]);
  });
});
