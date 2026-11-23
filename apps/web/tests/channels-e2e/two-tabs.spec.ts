import { ChannelView } from './harness/channel';
import { expect, test } from './harness/fixtures';

// If this fails, someone with the app open in two windows sees a message
// they sent in one missing, or twice, in the other.
test('TAB-01 a message sent in one window shows once in the same person’s other window', async ({
  page,
  context,
  ada,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.post(channel.id, 'before');
  const first = new ChannelView(page, channel.id);
  await first.open();
  const second = new ChannelView(await context.newPage(), channel.id);
  await second.open();
  await expect(second.message('before')).toBeVisible();

  await page.bringToFront();
  await first.send('from the first window');

  await second.expectEndsWith(['before', 'from the first window']);
  await first.expectEndsWith(['before', 'from the first window']);
});

// If this fails, an edit, a reaction or a deletion made in one window
// leaves the same person’s other window showing the old message.
test('TAB-02 an edit, a reaction and a deletion made in one window show in the other', async ({
  page,
  context,
  ada,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const [kept, edited, removed] = await ada.postAll(channel.id, [
    'kept',
    'to edit',
    'to delete',
  ]);
  const first = new ChannelView(page, channel.id);
  await first.open();
  const second = new ChannelView(await context.newPage(), channel.id);
  await second.open();
  await expect(second.message('to delete')).toBeVisible();

  await page.bringToFront();
  await first.action(first.messageById(edited.id), 'edit');
  const editor = page.locator(
    `[data-input-id="edit-message-input-${edited.id}"] [contenteditable="true"]`
  );
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('now edited');
  await page.keyboard.press('Enter');
  const keptActions = await first.actions(first.messageById(kept.id));
  await keptActions.getByRole('button', { name: 'React 👍' }).click();
  await first.action(first.messageById(removed.id), 'delete');
  await page
    .getByRole('dialog', { name: 'Delete message' })
    .getByRole('button', { name: 'Delete' })
    .click();

  await expect(second.messageById(removed.id)).toHaveCount(0);
  await expect(second.messageById(edited.id)).toContainText('now edited');
  await expect(
    second
      .messageById(kept.id)
      .locator('[data-message-reaction-chip][data-emoji="👍"]')
  ).toHaveCount(1);
});
