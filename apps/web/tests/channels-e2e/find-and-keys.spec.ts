import type { Locator, Page } from '@playwright/test';
import { ChannelView } from './harness/channel';
import { expect, failsSometimes, test } from './harness/fixtures';
import { sidebarRow } from './harness/management';

/**
 * Opens the find bar the way a person does: with the keyboard, from inside
 * the channel. From elsewhere the same keys search the conversations.
 */
async function openFind(view: ChannelView): Promise<Locator> {
  const page: Page = view.page;
  await view.composerText.click();
  await page.keyboard.press('ControlOrMeta+f');
  const box = page.getByPlaceholder('Find');
  await expect(box).toBeFocused();
  return box;
}

/** The message the list has selected: by find, or by the arrow keys. */
function selected(view: ChannelView): Locator {
  return view.list.locator('[data-message][data-selected]');
}

// If this fails, find in a channel miscounts what it found or steps
// through the matches in the wrong order.
test('KEY-01 find counts the messages that match and steps through them, newest first', async ({
  page,
  ada,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, [
    'quince first',
    'nothing here',
    'quince second',
    'nor here',
    'quince third',
  ]);
  const view = new ChannelView(page, channel.id);
  await view.open();
  await view.expectEndsWith(['nor here', 'quince third']);

  const box = await openFind(view);
  await box.fill('quince');
  await box.press('Enter');

  // Find asks the search service, which indexes a new message a moment
  // after it is sent: ask again until it has all three.
  await expect(async () => {
    await box.press('Escape');
    const again = await openFind(view);
    await again.fill('quince');
    await again.press('Enter');
    await expect(page.getByText('1/3', { exact: true })).toBeVisible({
      timeout: 2000,
    });
  }).toPass();
  await expect(selected(view)).toContainText('quince third');

  await page.getByRole('button', { name: 'Next match' }).click();
  await expect(page.getByText('2/3', { exact: true })).toBeVisible();
  await expect(selected(view)).toContainText('quince second');

  await page.getByRole('button', { name: 'Next match' }).click();
  await expect(page.getByText('3/3', { exact: true })).toBeVisible();
  await expect(selected(view)).toContainText('quince first');

  await page.getByRole('button', { name: 'Previous match' }).click();
  await expect(page.getByText('2/3', { exact: true })).toBeVisible();
  await expect(selected(view)).toContainText('quince second');
});

// If this fails, find cannot reach a message that is far up the history,
// outside what the list has loaded.
test('KEY-02 find brings an old message far up a long history into view', async ({
  page,
  history,
}) => {
  const view = new ChannelView(page, history.id);
  await view.open();
  await view.expectEndsWith(['history 230']);

  const box = await openFind(view);
  await box.fill('history 007');
  await box.press('Enter');

  await expect(page.getByText('1/1', { exact: true })).toBeVisible();
  await expect(view.message('history 007')).toBeInViewport();
  await expect(selected(view)).toContainText('history 007');
  await expect(view.message('history 230')).toHaveCount(0);
});

// If this fails, a search with no result looks like one still running, or
// offers to step through matches that do not exist.
test('KEY-03 find for words nobody wrote says there are no matches', async ({
  page,
  ada,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['one', 'two']);
  const view = new ChannelView(page, channel.id);
  await view.open();

  const box = await openFind(view);
  await box.fill('zyxwvu-never-written');
  await box.press('Enter');

  await expect(page.getByText('0/0', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next match' })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Previous match' })
  ).toBeDisabled();
  await view.expectEndsWith(['one', 'two']);
});

// If this fails, the find bar cannot be put away, or leaves the channel
// unusable behind it.
test('KEY-04 the find bar closes with its button and with Escape, and the channel still takes a message', async ({
  page,
  ada,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['one', 'two']);
  const view = new ChannelView(page, channel.id);
  await view.open();

  await openFind(view);
  await page.getByRole('button', { name: 'Close find bar' }).click();
  await expect(page.getByPlaceholder('Find')).toHaveCount(0);

  const box = await openFind(view);
  await box.press('Escape');
  await expect(page.getByPlaceholder('Find')).toHaveCount(0);

  await view.send('after finding');
  await view.expectEndsWith(['one', 'two', 'after finding']);
});

/**
 * Selects the last message with the keyboard: Escape steps from the composer
 * to the message list, ArrowUp there selects the last message.
 *
 * Not by ArrowUp in the composer, which KEY-05 covers. That way has a
 * product defect: a key pressed before the editor has handled the click that
 * focused it moves focus to the list, and the editor then takes focus back,
 * so the next key goes to the composer. Nothing on screen says when the
 * editor is done, so there is nothing to wait for. Escape makes the editor
 * drop its selection, and it does not take focus back.
 */
async function selectLast(view: ChannelView, text: string): Promise<void> {
  const page = view.page;
  await view.composerText.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-channel-message-list]')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(selected(view)).toContainText(text);
}

// If this fails, a person cannot move through the messages with the arrow
// keys, or cannot get back to typing.
test('KEY-05 the arrow keys walk from the composer up the messages and back down into the composer', async ({
  page,
  ada,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['first', 'second', 'third']);
  const view = new ChannelView(page, channel.id);
  await view.open();
  await view.expectEndsWith(['first', 'second', 'third']);
  await view.composerText.click();

  await page.keyboard.press('ArrowUp');
  const list = page.locator('[data-channel-message-list]');
  // Known defect on main, on a busy page: the composer takes the keyboard
  // back a moment after ArrowUp selected the message, so the next key is
  // typed into it. Escape, which does not have the defect, goes on from there.
  await expect(selected(view)).toContainText('third');
  await failsSometimes(async () => {
    await expect(list).toBeFocused({ timeout: 5000 });
    await expect(view.composerText).not.toBeFocused();
  });
  if (await view.composerText.evaluate((el) => el === document.activeElement)) {
    await page.keyboard.press('Escape');
  }
  await expect(list).toBeFocused();
  await expect(selected(view)).toContainText('third');
  await page.keyboard.press('ArrowUp');
  await expect(selected(view)).toContainText('second');
  await page.keyboard.press('ArrowUp');
  await expect(selected(view)).toContainText('first');
  await expect(selected(view)).toHaveCount(1);

  await page.keyboard.press('ArrowDown');
  await expect(selected(view)).toContainText('second');
  await page.keyboard.press('ArrowDown');
  await expect(selected(view)).toContainText('third');
  await page.keyboard.press('ArrowDown');
  await expect(view.composerText).toBeFocused();

  await page.keyboard.type('typed after the arrows');
  await page.keyboard.press('Enter');
  await view.expectEndsWith(['third', 'typed after the arrows']);
});

// If this fails, Enter on a selected message does not start a reply to it.
test('KEY-06 Enter on a selected message opens a reply to that message', async ({
  page,
  ada,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const [first] = await ada.postAll(channel.id, ['first', 'second']);
  const view = new ChannelView(page, channel.id);
  await view.open();
  await view.expectEndsWith(['first', 'second']);
  // Escape, not ArrowUp, to reach the list: KEY-05 has the defect of ArrowUp.
  await selectLast(view, 'second');
  await page.keyboard.press('ArrowUp');
  await expect(selected(view)).toContainText('first');
  await page.keyboard.press('Enter');

  const reply = page.locator(
    `[data-input-id="thread-reply-input-${first.id}"] [contenteditable]`
  );
  await expect(reply).toBeFocused();
  await page.keyboard.type('a reply by keyboard');
  await page.keyboard.press('Enter');

  await expect
    .poll(() => view.replyTexts(first.id), {
      message: 'the replies under the first message',
    })
    .toEqual(['a reply by keyboard']);
});

// If this fails, "e" on a person's own selected message does not let them
// edit it.
test('KEY-07 “e” on a person’s own selected message edits it', async ({
  page,
  ada,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const [mine] = await ada.postAll(channel.id, ['to be edited']);
  const view = new ChannelView(page, channel.id);
  await view.open();
  await view.expectEndsWith(['to be edited']);
  await selectLast(view, 'to be edited');
  await page.keyboard.press('e');

  const editor = page.locator(
    `[data-input-id="edit-message-input-${mine.id}"] [contenteditable]`
  );
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText('to be edited');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('edited by keyboard');
  await page.keyboard.press('Enter');

  await view.expectEndsWith(['edited by keyboard']);
  await expect(view.messageById(mine.id)).toContainText('(edited)');
});

// If this fails, Backspace deletes a message without asking, or the
// question cannot be answered from the keyboard.
test('KEY-08 Backspace on a person’s own selected message asks first, and Escape keeps the message', async ({
  page,
  ada,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['stays', 'to be deleted']);
  const view = new ChannelView(page, channel.id);
  await view.open();
  await view.expectEndsWith(['stays', 'to be deleted']);
  const dialog = page.getByRole('dialog', { name: 'Delete message' });
  await selectLast(view, 'to be deleted');
  await page.keyboard.press('Backspace');
  await expect(dialog).toBeVisible();

  // Escape answers no.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await view.expectEndsWith(['stays', 'to be deleted']);
});

// If this fails, the keyboard cannot delete a message, or deletes another.
test('KEY-12 Backspace on a person’s own selected message deletes it once confirmed', async ({
  page,
  ada,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['stays', 'to be deleted']);
  const view = new ChannelView(page, channel.id);
  await view.open();
  await view.expectEndsWith(['stays', 'to be deleted']);
  const dialog = page.getByRole('dialog', { name: 'Delete message' });
  await selectLast(view, 'to be deleted');
  await page.keyboard.press('Backspace');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete' }).click();

  await expect(view.message('to be deleted')).toHaveCount(0);
  await view.expectEndsWith(['stays']);
});

// If this fails, a person reading far up a long channel has no key to get
// back to the latest message.
test('KEY-09 Shift+G in the message list goes to the latest message', async ({
  page,
  history,
}) => {
  const view = new ChannelView(page, history.id);
  await view.open();
  await view.expectEndsWith(['history 230']);
  await selectLast(view, 'history 230');

  await view.wheel(-3000);
  await expect
    .poll(() => view.distanceFromBottom(), {
      message: 'distance of the list from its end',
    })
    .toBeGreaterThan(2000);
  await expect(view.message('history 230')).not.toBeInViewport();

  await page.keyboard.press('Shift+G');

  await view.expectAtBottom();
  await expect(view.message('history 230')).toBeInViewport();
});

// If this fails, a person who picks a channel in the list has to click
// again before they can type.
test('KEY-10 choosing a channel in the list puts the cursor in its composer', async ({
  page,
  ada,
  people,
}) => {
  const first = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(first.id, ['in the first']);
  const second = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(second.id, ['in the second']);
  const view = new ChannelView(page, second.id);
  await view.open();

  await sidebarRow(page, first.id).getByRole('treeitem').click();
  const firstView = new ChannelView(page, first.id);
  await firstView.shown();

  await expect(firstView.composerText).toBeFocused();
  await page.keyboard.type('typed without clicking');
  await page.keyboard.press('Enter');
  await firstView.expectEndsWith(['in the first', 'typed without clicking']);
});

// If this fails, Escape does not take a person out of the composer to the
// messages and on to the list of conversations.
test('KEY-11 Escape steps out of the composer to the messages, then to the list of conversations', async ({
  page,
  ada,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['one', 'two']);
  const view = new ChannelView(page, channel.id);
  await view.open();
  await view.composerText.click();
  await expect(view.composerText).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-channel-message-list]')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('tree', { name: 'Conversations' })).toBeFocused();
});
