import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';

const FIXTURE = '/src/features/contracts/browser-test';
const NOW = '2026-11-12T18:00:00.000Z';
const pdf = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}.pdf`, import.meta.url));

const pdfPage = (page: Page, number: number) =>
  page.getByRole('group', { name: new RegExp(`^Page ${number} of`) });

/** Drag a field from the palette onto a point of a page, as fractions. */
async function place(
  page: Page,
  field: string,
  pageNumber: number,
  at: { x: number; y: number }
) {
  const target = pdfPage(page, pageNumber);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error(`Page ${pageNumber} is not laid out`);
  await page.getByRole('button', { name: field, exact: true }).dragTo(target, {
    targetPosition: { x: box.width * at.x, y: box.height * at.y },
  });
}

async function signEverything(signer: Page, title?: string) {
  await signer.getByRole('button', { name: 'Next field' }).click();
  await signer.getByRole('button', { name: 'Sign here' }).first().click();
  await signer.getByRole('button', { name: 'Adopt and sign' }).click();
  if (title) {
    await signer.getByRole('button', { name: 'Next field' }).click();
    await signer.getByRole('textbox', { name: 'Text Input' }).fill(title);
  }
  await expect(signer.getByText('All fields done')).toBeVisible();
  await signer.getByRole('button', { name: 'Finish' }).click();
  await expect(
    signer.getByRole('heading', { name: 'You’re done' })
  ).toBeVisible();
}

/** The signing link of one recipient of a seeded packet. */
async function seededToken(page: Page, title: string, recipientId: string) {
  await page.goto(`${FIXTURE}/workspace.html?seed=demo&now=${NOW}`, {
    waitUntil: 'networkidle',
  });
  return page.evaluate(
    ([packetTitle, id]) => {
      const stored =
        localStorage.getItem('macro:contracts:local:v1:fixture-viewer') ?? '{}';
      const packets: {
        title: string;
        recipients: {
          id: string;
          signedAt?: string;
          disclosureAcceptedAt?: string;
          access?: { token: string };
        }[];
      }[] = JSON.parse(stored).packets ?? [];
      return packets
        .find((packet) => packet.title === packetTitle)
        ?.recipients.find((recipient) => recipient.id === id);
    },
    [title, recipientId]
  );
}

test.describe('contracts', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('nothing is signed when the browser cannot store the signer’s consent', async ({
    page,
  }) => {
    const before = await seededToken(page, 'Northwind Order Form Q4', 'n1');
    await page.goto(
      `${FIXTURE}/signing.html?token=${before?.access?.token}&now=${NOW}`,
      { waitUntil: 'networkidle' }
    );
    await page.getByRole('button', { name: 'Next field' }).click();
    await page.getByRole('button', { name: 'Sign here' }).first().click();

    // An image larger than a packet keeps is refused before it is adopted.
    const adopt = page.getByRole('button', { name: 'Adopt and sign' });
    const method = page.getByRole('radiogroup', { name: 'How to sign' });
    await method.getByText('Upload', { exact: true }).click();
    await page.getByLabel('Signature image').setInputFiles({
      name: 'signature.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(400_000, 1),
    });
    await expect(page.getByText('That image is too large')).toBeVisible();
    await expect(adopt).toBeDisabled();

    await method.getByText('Type', { exact: true }).click();
    await adopt.click();
    await page.getByRole('button', { name: 'Next field' }).click();
    await page.getByRole('textbox', { name: 'Text Input' }).fill('Ops Lead');
    await expect(page.getByText('All fields done')).toBeVisible();

    // The browser's storage fills up before the signer finishes.
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      };
    });
    await page.getByRole('button', { name: 'Finish' }).click();

    await expect(
      page.getByText('That didn’t go through. Try again.')
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'You’re done' })
    ).toBeHidden();
    await expect(page.getByRole('button', { name: 'Finish' })).toBeEnabled();

    const after = await page.evaluate(() => {
      const stored =
        localStorage.getItem('macro:contracts:local:v1:fixture-viewer') ?? '{}';
      const packets: {
        title: string;
        recipients: {
          id: string;
          signedAt?: string;
          disclosureAcceptedAt?: string;
        }[];
      }[] = JSON.parse(stored).packets ?? [];
      return packets
        .find((packet) => packet.title === 'Northwind Order Form Q4')
        ?.recipients.find((recipient) => recipient.id === 'n1');
    });
    expect(after?.signedAt).toBeUndefined();
    expect(after?.disclosureAcceptedAt).toBeUndefined();
  });

  test('a packet goes from documents to a completed certificate', async ({
    page,
    context,
  }) => {
    await page.goto(`${FIXTURE}/workspace.html`, { waitUntil: 'networkidle' });

    // Set up: two documents, one outside signer, the sender countersigns.
    await page.getByRole('button', { name: 'New packet' }).first().click();
    await page
      .locator('input[type=file][multiple]')
      .setInputFiles([pdf('order-form'), pdf('master-services-agreement')]);
    await expect(page.getByText('master-services-agreement')).toBeVisible();
    await page.getByLabel('Packet title').fill('Acme MSA');
    await page.getByLabel('Full name').first().fill('Sarah Chen');
    await page.getByLabel('Email').first().fill('sarah.chen@acme.example');
    await page.getByRole('button', { name: 'Place fields' }).click();

    // Nobody has a signature field yet, so the packet cannot be sent.
    await expect(
      page.getByText('Sarah Chen has no signature field.')
    ).toBeVisible();

    await place(page, 'Signature', 2, { x: 0.33, y: 0.29 });
    await page.getByText('Signs #2').click();
    await place(page, 'Signature', 2, { x: 0.73, y: 0.29 });
    await page.getByText('master-services-agreement', { exact: true }).click();
    await place(page, 'Signature', 3, { x: 0.73, y: 0.36 });
    await page.getByText('Signs #1').click();
    await place(page, 'Signature', 3, { x: 0.33, y: 0.36 });
    await place(page, 'Text Input', 3, { x: 0.33, y: 0.45 });
    await place(page, 'Date Signed', 3, { x: 0.28, y: 0.49 });
    await expect(
      page.getByText('Avery Lee has a signature field in every document.')
    ).toBeVisible();

    // Leaving by the sidebar keeps the placement; if it cannot be stored the
    // editor stays open with the work in it.
    await page.evaluate(() => {
      const setItem = Storage.prototype.setItem;
      Object.assign(window, {
        restoreStorage: () => {
          Storage.prototype.setItem = setItem;
        },
      });
      Storage.prototype.setItem = () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      };
    });
    await page.getByRole('button', { name: 'All packets' }).click();
    await expect(page.getByText('That didn’t work. Try again.')).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Place fields for Acme MSA' })
    ).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { restoreStorage: () => void }).restoreStorage();
    });
    await page.getByRole('button', { name: 'All packets' }).click();
    await page.getByRole('button', { name: /Acme MSA/ }).click();
    await page
      .getByRole('region', { name: 'Packet: Acme MSA' })
      .getByRole('button', { name: 'Place fields' })
      .click();
    await expect(page.getByText('Signs #1 · 4 fields')).toBeVisible();

    // Review, then send.
    await page.getByRole('button', { name: 'Review and send' }).click();
    const review = page.getByRole('article', { name: 'Send for signature' });
    await expect(review.getByText('6 fields')).toBeVisible();
    await review.getByRole('button', { name: 'Send to Sarah' }).click();

    const drawer = page.getByRole('region', { name: 'Packet: Acme MSA' });
    await expect(drawer.getByText('Sent', { exact: true })).toBeVisible();
    // Signing in order: only the first signer has a link.
    await expect(drawer.getByText('Waiting for earlier signers')).toBeVisible();

    // The outside signer opens their link in another tab and signs.
    await drawer.getByRole('button', { name: 'Copy signing link' }).click();
    const link = await page.evaluate(() => document.body.dataset.copied ?? '');
    const signer = await context.newPage();
    await signer.goto(link, { waitUntil: 'networkidle' });
    await expect(signer.getByText('0 of 3 fields done')).toBeVisible();
    await expect(signer.getByRole('button', { name: 'Finish' })).toBeDisabled();
    await signEverything(signer, 'VP, Operations');

    // The sender's workspace follows along without a reload.
    await expect(drawer.getByText('Partially Signed')).toBeVisible();
    await drawer.getByRole('button', { name: 'Sign now' }).click();
    const own = await page.evaluate(() => document.body.dataset.opened ?? '');
    await signer.goto(own, { waitUntil: 'networkidle' });
    await signEverything(signer);

    await expect(
      drawer.getByText('Sequential order · 2 of 2 signed')
    ).toBeVisible();
    await expect(drawer.getByText('All parties signed')).toBeVisible();
    // A used link stops working.
    await signer.goto(link, { waitUntil: 'networkidle' });
    await expect(
      signer.getByRole('heading', { name: 'This signing link isn’t active' })
    ).toBeVisible();

    await drawer.getByRole('button', { name: 'Audit certificate' }).click();
    const certificate = page.getByRole('article', {
      name: 'Certificate of Completion',
    });
    await expect(certificate.getByText('Signer 2 of 2')).toBeVisible();
    await expect(certificate.getByText('Final, after Avery Lee')).toBeVisible();
    await expect(certificate.getByText('contract.completed')).toBeVisible();
    // The stored log is checked against its own hash chain.
    await expect(page.getByText('Audit log verified')).toBeVisible();
  });

  test('a database lists every packet status, and voiding closes a packet', async ({
    page,
  }) => {
    await page.goto(`${FIXTURE}/workspace.html?seed=demo&now=${NOW}`, {
      waitUntil: 'networkidle',
    });

    const table = page.getByRole('table', { name: 'Packets' });
    for (const status of [
      'Draft',
      'Sent',
      'Partially Signed',
      'Signed',
      'Declined',
      'Voided',
      'Expired',
    ]) {
      await expect(
        table.getByText(status, { exact: true }).first()
      ).toBeVisible();
    }
    await expect(table.getByText('Offline', { exact: true })).toBeVisible();

    // A packet marked signed by hand has a completion time on its certificate.
    await table.getByRole('button', { name: /Tailspin DPA/ }).click();
    const offline = page.getByRole('region', { name: 'Packet: Tailspin DPA' });
    await expect(
      offline.getByText('Signed outside Macro').first()
    ).toBeVisible();
    await offline.getByRole('button', { name: 'Audit certificate' }).click();
    const offlineCertificate = page.getByRole('article', {
      name: 'Certificate of Completion',
    });
    await expect(
      offlineCertificate.getByText('2026-10-20 17:00:00 UTC').first()
    ).toBeVisible();
    await page.keyboard.press('Escape');

    // The same packet lives in more than one database.
    await page.getByRole('button', { name: 'Sales Deals' }).click();
    await expect(table.getByRole('row')).toHaveCount(2);
    await table.getByRole('button', { name: /Acme MSA/ }).click();
    const drawer = page.getByRole('region', { name: 'Packet: Acme MSA' });
    await expect(drawer.getByText('Finance / Revenue')).toBeVisible();
    await expect(drawer.getByText('Signed Nov 10')).toBeVisible();

    await drawer.getByRole('button', { name: 'Void', exact: true }).click();
    await page
      .getByRole('button', { name: 'Void', exact: true })
      .last()
      .click();
    await expect(drawer.getByText('Voided', { exact: true })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Sign now' })).toHaveCount(
      0
    );

    await page.getByRole('button', { name: 'Needs my signature' }).click();
    await expect(page.getByText('No packets here yet')).toBeVisible();
  });

  test('a signed packet downloads as one PDF with its certificate', async ({
    page,
  }) => {
    await page.goto(`${FIXTURE}/workspace.html?seed=demo&now=${NOW}`, {
      waitUntil: 'networkidle',
    });
    await page.getByRole('button', { name: /Contoso Renewal 2027/ }).click();
    const drawer = page.getByRole('region', {
      name: 'Packet: Contoso Renewal 2027',
    });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      drawer.getByRole('button', { name: 'Download PDF' }).click(),
    ]);

    expect(download.suggestedFilename()).toBe('Contoso Renewal 2027.pdf');
    const file = await readFile(await download.path(), 'latin1');
    expect(file.startsWith('%PDF-1.4')).toBe(true);
    // Two pages of order form, three of agreement, one of certificate.
    expect(file.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(6);
    await expect(page.getByText('PDF downloaded')).toBeVisible();
  });

  test('a packet created by mistake merges into the one it should have been', async ({
    page,
  }) => {
    await page.goto(`${FIXTURE}/workspace.html?seed=demo&now=${NOW}`, {
      waitUntil: 'networkidle',
    });
    await page.getByRole('button', { name: 'All packets' }).click();
    const table = page.getByRole('table', { name: 'Packets' });
    const before = await table.getByRole('row').count();

    await table
      .getByRole('button', { name: /Fabrikam Pilot Agreement/ })
      .click();
    const drawer = page.getByRole('region', {
      name: 'Packet: Fabrikam Pilot Agreement',
    });
    await drawer.getByRole('button', { name: 'Merge packet' }).click();

    const dialog = page.getByRole('dialog');
    // Closed packets are not offered: only open ones can be folded in.
    await expect(dialog.getByText('Contoso Renewal 2027')).toHaveCount(0);
    await dialog.getByText('Northwind Order Form Q4').click();
    await dialog.getByRole('button', { name: 'Merge', exact: true }).click();

    await expect(page.getByText('Packets merged')).toBeVisible();
    await expect(table.getByRole('row')).toHaveCount(before - 1);
    await expect(
      table.getByRole('button', { name: /Northwind Order Form Q4/ })
    ).toHaveCount(0);
    await expect(
      drawer.getByText('merged “Northwind Order Form Q4” into this packet')
    ).toBeVisible();
  });
});

test.describe('signing on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the signer adopts a signature in a sheet and finishes', async ({
    page,
  }) => {
    const token = (await seededToken(page, 'Northwind Order Form Q4', 'n1'))
      ?.access?.token;

    await page.goto(`${FIXTURE}/signing.html?token=${token}&now=${NOW}`, {
      waitUntil: 'networkidle',
    });
    await expect(page.getByText('0 of 2 fields done')).toBeVisible();

    await page.getByRole('button', { name: 'Next field' }).tap();
    await page.getByRole('button', { name: 'Sign here' }).tap();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('Adopt your signature')).toBeVisible();
    await sheet.getByRole('button', { name: 'Adopt and sign' }).tap();

    await page.getByRole('button', { name: 'Next field' }).tap();
    await page
      .getByRole('textbox', { name: 'Text Input' })
      .fill('Operations Lead');
    await page.getByRole('button', { name: 'Finish' }).tap();
    await expect(
      page.getByRole('heading', { name: 'You’re done' })
    ).toBeVisible();
  });
});
