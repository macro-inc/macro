import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { replyEditor } from './harness/send';
import {
  envelopeRow,
  replyTo,
  send,
  sentCopy,
  YARA,
} from './harness/ways-compose2';
import type { ActionId } from './ledger/manifest';
import { did } from './ledger/record';

test.beforeEach(({ page }) => loadAppSteadily(page));

/** Opens the reply's envelope from its one-line summary. */
async function expand(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Replying to Xavier/ }).click();
  did('AC-073');
  await expect(page.getByText('From', { exact: true })).toBeVisible();
  await expect(
    envelopeRow(page, 'To').getByRole('link', { name: /xavier@example\.com/ })
  ).toBeVisible();
}

const hotkey = (keys: string) => async (page: Page) => {
  await replyEditor(page).click();
  await page.keyboard.press(keys);
};

/** Every way to reveal a hidden copy field of a reply. */
const REVEALS: {
  row: ActionId;
  field: 'cc' | 'bcc';
  reveal: (page: Page) => Promise<void>;
}[] = [
  {
    row: 'AC-074',
    field: 'cc',
    reveal: async (page) => {
      await expand(page);
      await page.getByRole('button', { name: 'Cc', exact: true }).click();
    },
  },
  {
    row: 'AC-075',
    field: 'bcc',
    reveal: async (page) => {
      await expand(page);
      await page.getByRole('button', { name: 'Bcc', exact: true }).click();
    },
  },
  { row: 'AC-308', field: 'cc', reveal: hotkey('Shift+ControlOrMeta+KeyC') },
  { row: 'AC-309', field: 'bcc', reveal: hotkey('Shift+ControlOrMeta+KeyB') },
];

for (const provider of ['GMAIL', 'OUTLOOK'] as const) {
  test.describe(`the envelope of a reply in ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });

    // When this fails, one of the ways to add a copy to a reply (the Cc or
    // Bcc button of the opened envelope, or its shortcut) no longer shows the
    // field with the cursor in it, or the address typed there does not reach
    // the reply the provider sends: the copy silently goes to nobody.
    test('every way to reveal Cc or Bcc puts the cursor in a field whose address the reply is sent to', async ({
      page,
      mailbox,
    }) => {
      for (const way of REVEALS) {
        await test.step(way.row, async () => {
          const subject = `Copy by ${way.row}`;
          await replyTo(page, mailbox, subject);
          await way.reveal(page);
          did(way.row);
          // The cursor is in the revealed field: what is typed lands there.
          await expect(page.locator(':focus')).toHaveAttribute(
            'role',
            'combobox'
          );
          await page.keyboard.type(YARA);
          await page.keyboard.press('Enter');
          await replyEditor(page).click();
          await page.keyboard.type('Copying Yara.');
          await send(page);

          const sent = await sentCopy(mailbox, `Re: ${subject}`);
          expect(sent[way.field], way.row).toEqual([YARA]);
          expect(sent[way.field === 'cc' ? 'bcc' : 'cc'], way.row).toEqual([]);
        });
      }
    });

    // When this fails, a recipient chip dragged from one field of a reply to
    // another stays where it was (or vanishes): the reply goes to them in the
    // field the writer moved them out of.
    test('a chip dragged from Cc to To is sent as a direct recipient', async ({
      page,
      mailbox,
    }) => {
      const subject = 'Move Yara';
      await replyTo(page, mailbox, subject, { all: true });
      await expand(page);
      const chip = envelopeRow(page, 'Cc').getByRole('link', {
        name: /yara@example\.com/,
      });
      await expect(chip).toBeVisible();

      await chip.dragTo(envelopeRow(page, 'To'));
      did('AC-078');
      await expect(
        envelopeRow(page, 'To').getByRole('link', { name: /yara@example\.com/ })
      ).toBeVisible();
      await replyEditor(page).click();
      await page.keyboard.type('Both of you.');
      await send(page);

      const sent = await sentCopy(mailbox, `Re: ${subject}`);
      expect(sent.to.sort()).toEqual(['xavier@example.com', YARA]);
      expect(sent.cc).toEqual([]);
    });
  });
}
