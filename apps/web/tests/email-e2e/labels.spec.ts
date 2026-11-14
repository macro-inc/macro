// Tags and properties of a thread: a tag put on and taken off from the list,
// the list filtered by a tag from a row's chip, and a property set in the
// thread's side panel. Each for a Gmail and an Outlook inbox.

import type { Page } from '@playwright/test';
import { expect, type Mailbox, test } from './harness/fixtures';
import { focusRow, rowIds } from './harness/list';
import {
  createTag,
  tagThread,
  threadProperties,
  threadTagIds,
} from './harness/organise';
import { confirmed, did, saw } from './ledger/record';

const from = 'Grace <grace@example.com>';

/** The row of a thread in the list. */
function row(page: Page, threadId: string) {
  return page.locator(`[data-soup-entity] [data-entity-id="${threadId}"]`);
}

/** The chip of a tag on a row. */
function chip(page: Page, threadId: string, tag: string) {
  return row(page, threadId).getByRole('button', {
    name: `Change or select tag ${tag}`,
  });
}

/** The names of the options the storage service holds as a thread's priority. */
async function priority(mailbox: Mailbox, threadId: string) {
  const held = (await threadProperties(mailbox, threadId)).find(
    (property) => property.definition.display_name === 'Priority'
  );
  const picked = JSON.stringify(held?.value ?? null);
  return (held?.options ?? [])
    .filter((option) => picked.includes(option.id))
    .map((option) => (option.value as { value?: unknown } | undefined)?.value);
}

for (const provider of ['GMAIL', 'OUTLOOK'] as const) {
  test.describe(`tags and properties on a ${provider} inbox`, () => {
    test.use({ provider });

    // Fails when the t key no longer opens the tag picker on a row, when
    // picking a tag does not put it on the thread (no chip, nothing stored),
    // or when picking it again does not take it off.
    test('a tag is put on a thread from the list, then taken off', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Lunch?', text: 'Noon?' });
      await mailbox.deliver({ from, subject: 'Minutes', text: 'Attached.' });
      const thread = await mailbox.synced('Lunch?');
      const other = await mailbox.synced('Minutes');
      const tag = await createTag(mailbox, 'urgent');
      await mailbox.open();

      await focusRow(page, thread.id);
      await page.keyboard.press('t');
      did('AL-073');
      await page.getByRole('option', { name: /^urgent/ }).click();
      await page.keyboard.press('Escape');
      await expect(chip(page, thread.id, 'urgent')).toBeVisible();
      await expect(chip(page, other.id, 'urgent')).toBeHidden();
      await expect
        .poll(() => threadTagIds(mailbox, thread.id))
        .toEqual([tag.optionId]);
      expect(await threadTagIds(mailbox, other.id)).toEqual([]);

      await focusRow(page, thread.id);
      await page.keyboard.press('t');
      await page.getByRole('option', { name: /^urgent/ }).click();
      await page.keyboard.press('Escape');
      await expect(chip(page, thread.id, 'urgent')).toBeHidden();
      saw('STL-982');
      await expect.poll(() => threadTagIds(mailbox, thread.id)).toEqual([]);
      confirmed('F-084');
    });

    // Fails when the chip's Filter button no longer narrows the list to the
    // threads carrying the tag, or when All mail's title does not name it.
    test('the chip of a tag on a row filters All mail by that tag', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Lunch?', text: 'Noon?' });
      await mailbox.deliver({ from, subject: 'Minutes', text: 'Attached.' });
      const thread = await mailbox.synced('Lunch?');
      const other = await mailbox.synced('Minutes');
      await tagThread(mailbox, thread.id, await createTag(mailbox, 'urgent'));
      await mailbox.open();
      await page
        .getByRole('navigation', { name: 'Email library' })
        .getByRole('button', { name: 'All mail' })
        .click();
      const location = page.getByRole('navigation', { name: 'Email location' });
      await expect(location.getByRole('button', { name: 'All' })).toBeVisible();
      await expect
        .poll(() => rowIds(page))
        .toEqual(expect.arrayContaining([thread.id, other.id]));

      await chip(page, thread.id, 'urgent').hover();
      await page.getByRole('button', { name: 'Filter by urgent' }).click();
      did('AL-099');
      await expect(
        location.getByRole('button', { name: 'urgent' })
      ).toBeVisible();
      await expect.poll(() => rowIds(page)).toEqual([thread.id]);
      saw('STL-406');
    });

    // Fails when the side panel no longer lists a thread's properties, when
    // a property picked there is not added with the value chosen, or when
    // the value is not what the storage service keeps.
    test('a property of a thread is set in its side panel', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Lunch?', text: 'Noon?' });
      const thread = await mailbox.synced('Lunch?');
      await mailbox.open(`/app/mail/${thread.id}`);
      await expect(page.getByText('Noon?')).toBeVisible();

      await page.getByRole('button', { name: 'Show details' }).click();
      const panel = page.getByRole('complementary', { name: 'Block details' });
      const properties = panel.getByRole('region', { name: 'Properties' });
      await expect(panel.getByRole('region', { name: 'Tags' })).toBeVisible();
      await expect(properties).toBeVisible();
      await expect(
        panel.getByRole('heading', { name: 'Activity' })
      ).toBeVisible();
      saw('STL-109');

      await properties.getByRole('button', { name: 'Add property' }).click();
      await page.getByRole('option', { name: 'Priority' }).click();
      await page.getByRole('option', { name: /^High/ }).click();
      did('AL-193', 'F-088');
      await expect(
        properties.getByText('Priority', { exact: true })
      ).toBeVisible();
      await expect(
        properties.getByRole('button', { name: 'High' })
      ).toBeVisible();
      saw('STL-983');
      await expect.poll(() => priority(mailbox, thread.id)).toEqual(['High']);
      confirmed('F-088');
    });
  });
}
