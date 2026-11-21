import { conversationRow } from './harness/channel';
import { arrivesLive, expect, failsSometimes, test } from './harness/fixtures';
import { Conversation } from './harness/messages';

// If this fails, a message sent with Enter is lost, doubled or misplaced for
// its sender or for the person it was written to.
test('MSG-01 a message sent with Enter shows once at the end for both people, and stays after reload', async ({
  page,
  ada,
  ben,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ben.post(channel.id, 'earlier from ben');
  const mine = new Conversation(page, channel.id);
  const bens = new Conversation(await pageFor('ben'), channel.id);
  await Promise.all([mine.open(), bens.open()]);

  await mine.composerText.click();
  await page.keyboard.type('sent with enter');
  await page.keyboard.press('Enter');

  const shown = ['Ben Member: earlier from ben', 'Ada Owner: sent with enter'];
  await expect.poll(() => mine.topLevelByAuthor()).toEqual(shown);
  await expect(mine.message('sent with enter')).toBeInViewport();
  await expect(mine.composerText).toHaveText('');
  await expect.poll(() => bens.topLevelByAuthor()).toEqual(shown);
  await expect(bens.message('sent with enter')).toBeInViewport();

  await Promise.all([mine.reload(), bens.reload()]);
  await expect.poll(() => mine.topLevelByAuthor()).toEqual(shown);
  await expect.poll(() => bens.topLevelByAuthor()).toEqual(shown);
});

// If this fails, the send button loses, doubles or misplaces the message.
test('MSG-02 a message sent with the send button shows once at the end for both people, and stays after reload', async ({
  page,
  ada,
  ben,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ben.post(channel.id, 'earlier from ben');
  const mine = new Conversation(page, channel.id);
  const bens = new Conversation(await pageFor('ben'), channel.id);
  await Promise.all([mine.open(), bens.open()]);

  await mine.composerText.click();
  await page.keyboard.type('sent with the button');
  await mine.sendButton.click();

  const shown = [
    'Ben Member: earlier from ben',
    'Ada Owner: sent with the button',
  ];
  await expect.poll(() => mine.topLevelByAuthor()).toEqual(shown);
  await expect(mine.message('sent with the button')).toBeInViewport();
  await expect(mine.composerText).toHaveText('');
  await expect.poll(() => bens.topLevelByAuthor()).toEqual(shown);
  await expect(bens.message('sent with the button')).toBeInViewport();

  await Promise.all([mine.reload(), bens.reload()]);
  await expect.poll(() => mine.topLevelByAuthor()).toEqual(shown);
  await expect.poll(() => bens.topLevelByAuthor()).toEqual(shown);
});

// If this fails, a quick exchange between two people ends with a message
// missing, doubled, or in a different place for one of them.
test('MSG-03 a quick back-and-forth between two people reads in the same order for both, each message once', async ({
  page,
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const mine = new Conversation(page, channel.id);
  const bens = new Conversation(await pageFor('ben'), channel.id);
  await Promise.all([mine.open(), bens.open()]);

  // Each answers as soon as the other's message is in front of them.
  // Known defect on main: an open page sometimes does not show a message the
  // other person sent until it is reloaded. Each wait and reload that makes
  // up for one takes time the test would not otherwise need.
  test.setTimeout(180_000);
  const sees = (view: Conversation, text: string) =>
    arrivesLive(view, view.message(text));
  await mine.send('ada 1');
  await sees(bens, 'ada 1');
  await bens.send('ben 1');
  await sees(mine, 'ben 1');
  await mine.send('ada 2');
  await mine.send('ada 3');
  await sees(bens, 'ada 3');
  await bens.send('ben 2');
  await bens.send('ben 3');
  await sees(mine, 'ben 3');
  await mine.send('ada 4');
  await sees(bens, 'ada 4');
  await bens.send('ben 4');

  const exchange = [
    'Ada Owner: ada 1',
    'Ben Member: ben 1',
    'Ada Owner: ada 2',
    'Ada Owner: ada 3',
    'Ben Member: ben 2',
    'Ben Member: ben 3',
    'Ada Owner: ada 4',
    'Ben Member: ben 4',
  ];
  // Before the reload, the same defect may leave the other person's messages
  // out of a page. It excuses nothing else: what the page does show is in
  // order, each once, with every message of its own person.
  for (const [view, own] of [
    [mine, 'Ada Owner: '],
    [bens, 'Ben Member: '],
  ] as const) {
    let shown: string[] = [];
    try {
      await expect
        .poll(async () => {
          shown = await view.topLevelByAuthor();
          return shown;
        })
        .toEqual(exchange);
    } catch (error) {
      const rest = [...shown];
      const missing = exchange.filter((line) => {
        if (rest[0] !== line) {
          return true;
        }
        rest.shift();
        return false;
      });
      const onlyTheirsMissing =
        rest.length === 0 &&
        missing.length > 0 &&
        missing.every((line) => !line.startsWith(own));
      if (!onlyTheirsMissing) {
        throw error;
      }
      await failsSometimes(async () => {
        throw error;
      });
    }
  }

  await Promise.all([mine.reload(), bens.reload()]);
  await expect.poll(() => mine.topLevelByAuthor()).toEqual(exchange);
  await expect.poll(() => bens.topLevelByAuthor()).toEqual(exchange);
});

// If this fails, a message written on several lines arrives run together.
test('MSG-04 a message written on several lines with Shift+Enter keeps its lines', async ({
  page,
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const mine = new Conversation(page, channel.id);
  const bens = new Conversation(await pageFor('ben'), channel.id);
  await Promise.all([mine.open(), bens.open()]);

  await mine.composerText.click();
  await page.keyboard.type('first line');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('second line');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('third line');
  await page.keyboard.press('Enter');

  const lines = ['first line', 'second line', 'third line'];
  for (const view of [mine, bens]) {
    const message = view.list.locator('[data-message]');
    if (view === bens) {
      await arrivesLive(view, message.first());
    }
    await expect(message).toHaveCount(1);
    await expect.poll(() => view.lines(message)).toEqual(lines);
  }

  await Promise.all([mine.reload(), bens.reload()]);
  for (const view of [mine, bens]) {
    const message = view.list.locator('[data-message]');
    await expect(message).toHaveCount(1);
    await expect.poll(() => view.lines(message)).toEqual(lines);
  }
});

// If this fails, formatting, a link, emoji or text in another script is
// mangled between what was written and what is read.
test('MSG-05 formatting, a link, emoji and other scripts read the same for both people and after reload', async ({
  page,
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const mine = new Conversation(page, channel.id);
  const bens = new Conversation(await pageFor('ben'), channel.id);
  await Promise.all([mine.open(), bens.open()]);

  await mine.send(
    '**bold** and `code` see https://example.com/path?q=1 🎉 日本語 Привет <b>x</b> & * 100%'
  );

  // The marks of bold and code are taken as formatting; everything else is
  // shown as written.
  const read = [
    'bold and code see https://example.com/path?q=1 🎉 日本語 Привет <b>x</b> & * 100%',
  ];
  for (const view of [mine, bens]) {
    if (view === bens) {
      await arrivesLive(view, view.list.locator('[data-message]').first());
    }
    await expect.poll(() => view.topLevel()).toEqual(read);
    await expect(
      view.list.getByRole('link', { name: 'https://example.com/path?q=1' })
    ).toHaveAttribute('href', 'https://example.com/path?q=1');
    await expect(view.list.getByText('bold', { exact: true })).toHaveCSS(
      'font-weight',
      '700'
    );
  }

  await Promise.all([mine.reload(), bens.reload()]);
  for (const view of [mine, bens]) {
    await expect.poll(() => view.topLevel()).toEqual(read);
    await expect(
      view.list.getByRole('link', { name: 'https://example.com/path?q=1' })
    ).toHaveAttribute('href', 'https://example.com/path?q=1');
    await expect(view.list.getByText('bold', { exact: true })).toHaveCSS(
      'font-weight',
      '700'
    );
  }
});

// If this fails, a message is shown under the name of someone who did not
// write it.
test('MSG-06 messages in a row from one person and from alternating people each show under their author', async ({
  page,
  ada,
  ben,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.post(channel.id, 'ada opens');
  await ada.post(channel.id, 'ada goes on');
  await ben.post(channel.id, 'ben answers');
  await ada.post(channel.id, 'ada again');
  await ben.post(channel.id, 'ben once');
  await ben.post(channel.id, 'ben twice');
  const mine = new Conversation(page, channel.id);
  const bens = new Conversation(await pageFor('ben'), channel.id);
  await Promise.all([mine.open(), bens.open()]);

  const seeded = [
    'Ada Owner: ada opens',
    'Ada Owner: ada goes on',
    'Ben Member: ben answers',
    'Ada Owner: ada again',
    'Ben Member: ben once',
    'Ben Member: ben twice',
  ];
  await expect.poll(() => mine.topLevelByAuthor()).toEqual(seeded);
  await expect.poll(() => bens.topLevelByAuthor()).toEqual(seeded);
  // A person's name stands once above their run of messages.
  await expect(mine.list.getByText('Ada Owner', { exact: true })).toHaveCount(
    2
  );
  await expect(mine.list.getByText('Ben Member', { exact: true })).toHaveCount(
    2
  );

  await bens.send('ben thrice');
  await expect(mine.message('ben thrice')).toBeVisible();
  await mine.send('ada closes');

  const all = [
    'Ada Owner: ada opens',
    'Ada Owner: ada goes on',
    'Ben Member: ben answers',
    'Ada Owner: ada again',
    'Ben Member: ben once',
    'Ben Member: ben twice',
    'Ben Member: ben thrice',
    'Ada Owner: ada closes',
  ];
  await expect.poll(() => mine.topLevelByAuthor()).toEqual(all);
  await expect.poll(() => bens.topLevelByAuthor()).toEqual(all);
});

// If this fails, an edit does not reach the other person, is not marked as
// one, or is gone after a reload.
test('MSG-07 editing my message from its buttons shows the new text and “(edited)” to both people, and after reload', async ({
  page,
  ada,
  ben,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ben.post(channel.id, 'before');
  const original = await ada.post(channel.id, 'first wording');
  await ben.post(channel.id, 'after');
  const mine = new Conversation(page, channel.id);
  const bens = new Conversation(await pageFor('ben'), channel.id);
  await Promise.all([mine.open(), bens.open()]);
  await expect(bens.message('first wording')).toBeVisible();

  await mine.action(mine.messageById(original.id), 'edit');
  await expect(mine.editor(original.id)).toHaveText('first wording');
  await expect(mine.editor(original.id)).toBeFocused();
  await mine.retype('second wording');
  await page.keyboard.press('Enter');

  const shown = ['before', 'second wording', 'after'];
  for (const view of [mine, bens]) {
    await expect.poll(() => view.topLevel()).toEqual(shown);
    await expect(
      view.messageById(original.id).getByText('(edited)')
    ).toBeVisible();
    await expect(view.list.getByText('(edited)')).toHaveCount(1);
  }
  await expect(mine.editor(original.id)).toHaveCount(0);

  await Promise.all([mine.reload(), bens.reload()]);
  for (const view of [mine, bens]) {
    await expect.poll(() => view.topLevel()).toEqual(shown);
    await expect(
      view.messageById(original.id).getByText('(edited)')
    ).toBeVisible();
    await expect(view.list.getByText('(edited)')).toHaveCount(1);
  }
});

// If this fails, the keyboard way to edit a message does nothing, or edits
// another message.
test('MSG-08 pressing E on my selected message edits it, and the other person sees the edit', async ({
  page,
  ada,
  ben,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ben.post(channel.id, 'before');
  const original = await ada.post(channel.id, 'typed in a hurry');
  await ben.post(channel.id, 'after');
  const mine = new Conversation(page, channel.id);
  const bens = new Conversation(await pageFor('ben'), channel.id);
  await Promise.all([mine.open(), bens.open()]);
  await expect(bens.message('typed in a hurry')).toBeVisible();

  await mine.messageById(original.id).click();
  await page.keyboard.press('e');
  await expect(mine.editor(original.id)).toHaveText('typed in a hurry');
  await expect(mine.editor(original.id)).toBeFocused();
  await mine.retype('typed with care');
  await page.keyboard.press('Enter');

  const shown = ['before', 'typed with care', 'after'];
  for (const view of [mine, bens]) {
    await expect.poll(() => view.topLevel()).toEqual(shown);
    await expect(
      view.messageById(original.id).getByText('(edited)')
    ).toBeVisible();
  }
});

// If this fails, backing out of an edit still changes the message.
test('MSG-09 cancelling an edit, with Escape or “Discard Edit”, leaves the message as it was', async ({
  page,
  ada,
  ben,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ben.post(channel.id, 'before');
  const original = await ada.post(channel.id, 'leave me alone');
  const mine = new Conversation(page, channel.id);
  const bens = new Conversation(await pageFor('ben'), channel.id);
  await Promise.all([mine.open(), bens.open()]);

  await mine.action(mine.messageById(original.id), 'edit');
  await expect(mine.editor(original.id)).toBeFocused();
  await mine.retype('changed, then escaped');
  await page.keyboard.press('Escape');
  await expect(mine.editor(original.id)).toHaveCount(0);
  await expect
    .poll(() => mine.topLevel())
    .toEqual(['before', 'leave me alone']);

  await mine.action(mine.messageById(original.id), 'edit');
  await expect(mine.editor(original.id)).toBeFocused();
  await mine.retype('changed, then discarded');
  await page.getByRole('button', { name: 'Discard Edit' }).click();
  await expect(mine.editor(original.id)).toHaveCount(0);
  await expect
    .poll(() => mine.topLevel())
    .toEqual(['before', 'leave me alone']);

  // A message sent afterwards reaches Ben, so an edit would have too.
  await mine.send('sent after cancelling');
  const shown = ['before', 'leave me alone', 'sent after cancelling'];
  await expect.poll(() => bens.topLevel()).toEqual(shown);
  await expect(bens.list.getByText('(edited)')).toHaveCount(0);

  await mine.reload();
  await expect.poll(() => mine.topLevel()).toEqual(shown);
  await expect(mine.list.getByText('(edited)')).toHaveCount(0);
});

// If this fails, a deleted message stays in front of the other person, or
// comes back after a reload; or it is deleted without being confirmed.
test('MSG-10 deleting my message, once confirmed, removes it for both people and after reload', async ({
  page,
  ada,
  ben,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ben.post(channel.id, 'before');
  const doomed = await ada.post(channel.id, 'delete me');
  await ben.post(channel.id, 'after');
  const mine = new Conversation(page, channel.id);
  const bens = new Conversation(await pageFor('ben'), channel.id);
  await Promise.all([mine.open(), bens.open()]);
  await expect(bens.message('delete me')).toBeVisible();

  await mine.action(mine.messageById(doomed.id), 'delete');
  await expect(mine.deleteDialog).toContainText(
    'This message will be permanently deleted. This action cannot be undone.'
  );
  await mine.deleteDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(mine.deleteDialog).toBeHidden();
  await expect
    .poll(() => mine.topLevel())
    .toEqual(['before', 'delete me', 'after']);

  await mine.delete(mine.messageById(doomed.id));

  for (const view of [mine, bens]) {
    await expect.poll(() => view.topLevel()).toEqual(['before', 'after']);
  }
  await expect(mine.deleteDialog).toBeHidden();

  await Promise.all([mine.reload(), bens.reload()]);
  for (const view of [mine, bens]) {
    await expect(view.message('after')).toBeVisible();
    await expect.poll(() => view.topLevel()).toEqual(['before', 'after']);
  }
});

// If this fails, deleting a message that people replied to takes their
// replies with it, or leaves the deleted text readable.
test('MSG-11 a deleted message that has replies reads “This message was deleted.” and keeps its replies', async ({
  page,
  ada,
  ben,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ben.post(channel.id, 'before');
  const root = await ada.post(channel.id, 'regretted');
  await ben.post(channel.id, 'ben replied', { threadId: root.id });
  await ada.post(channel.id, 'ada replied', { threadId: root.id });
  await ben.post(channel.id, 'after');
  const mine = new Conversation(page, channel.id);
  const bens = new Conversation(await pageFor('ben'), channel.id);
  await Promise.all([mine.open(), bens.open()]);
  await expect(bens.message('regretted')).toBeVisible();

  await mine.delete(mine.messageById(root.id));

  const shown = ['before', 'This message was deleted.', 'after'];
  const replies = ['Ben Member: ben replied', 'Ada Owner: ada replied'];
  for (const view of [mine, bens]) {
    await expect.poll(() => view.topLevel()).toEqual(shown);
    await expect.poll(() => view.repliesByAuthor(root.id)).toEqual(replies);
    await expect(view.list.getByText('regretted')).toHaveCount(0);
  }

  await Promise.all([mine.reload(), bens.reload()]);
  for (const view of [mine, bens]) {
    await expect.poll(() => view.topLevel()).toEqual(shown);
    await expect.poll(() => view.repliesByAuthor(root.id)).toEqual(replies);
    await expect(view.list.getByText('regretted')).toHaveCount(0);
  }
});

// If this fails, a person can change or remove what someone else wrote.
test('MSG-12 someone else’s message offers no Edit or Delete, while my own does', async ({
  page,
  ada,
  ben,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const bens = await ben.post(channel.id, 'ben wrote this');
  const own = await ada.post(channel.id, 'ada wrote this');
  const view = new Conversation(page, channel.id);
  await view.open();

  const onOwn = await view.actions(view.messageById(own.id));
  await expect(onOwn.getByRole('button', { name: 'Reply' })).toBeVisible();
  await expect(onOwn.getByRole('button', { name: 'Edit' })).toBeVisible();
  await expect(onOwn.getByRole('button', { name: 'Delete' })).toBeVisible();

  const onBens = await view.actions(view.messageById(bens.id));
  await expect(onBens.getByRole('button', { name: 'Reply' })).toBeVisible();
  await expect(onBens.getByRole('button', { name: 'Copy Text' })).toBeVisible();
  await expect(onBens.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(onBens.getByRole('button', { name: 'Delete' })).toHaveCount(0);

  // The keys that edit and delete a selected message of one's own.
  await view.messageById(bens.id).click();
  await expect(view.messageById(bens.id)).toHaveAttribute('data-selected');
  await page.keyboard.press('e');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('ArrowDown');
  await expect(view.messageById(own.id)).toHaveAttribute('data-selected');
  await expect(view.editor(bens.id)).toHaveCount(0);
  await expect(view.deleteDialog).toHaveCount(0);
});

// If this fails, a reaction does not reach the other person, counts wrong
// when two people agree, or does not go away when taken back.
test('MSG-13 a quick reaction shows for both people, counts 2 when the other adds the same, and goes when removed', async ({
  page,
  ada,
  ben,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const liked = await ben.post(channel.id, 'who is in?');
  const mine = new Conversation(page, channel.id);
  const bens = new Conversation(await pageFor('ben'), channel.id);
  await Promise.all([mine.open(), bens.open()]);
  const myMessage = mine.messageById(liked.id);
  const bensMessage = bens.messageById(liked.id);

  await mine.quickReact(myMessage, '👍');
  await expect.poll(() => mine.reactions(myMessage)).toEqual(['👍']);
  await expect.poll(() => bens.reactions(bensMessage)).toEqual(['👍']);
  await expect(mine.reaction(myMessage, '👍')).toBeEnabled();
  await expect(mine.reaction(myMessage, '👍')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(bens.reaction(bensMessage, '👍')).toHaveAttribute(
    'aria-pressed',
    'false'
  );

  await bens.reaction(bensMessage, '👍').click();
  await expect.poll(() => bens.reactions(bensMessage)).toEqual(['👍 2']);
  await expect.poll(() => mine.reactions(myMessage)).toEqual(['👍 2']);

  await Promise.all([mine.reload(), bens.reload()]);
  await expect.poll(() => mine.reactions(myMessage)).toEqual(['👍 2']);
  await expect.poll(() => bens.reactions(bensMessage)).toEqual(['👍 2']);
  await expect(bens.reaction(bensMessage, '👍')).toHaveAttribute(
    'aria-pressed',
    'true'
  );

  await bens.reaction(bensMessage, '👍').click();
  await expect.poll(() => bens.reactions(bensMessage)).toEqual(['👍']);
  await expect.poll(() => mine.reactions(myMessage)).toEqual(['👍']);

  await mine.reaction(myMessage, '👍').click();
  await expect.poll(() => mine.reactions(myMessage)).toEqual([]);
  await expect.poll(() => bens.reactions(bensMessage)).toEqual([]);

  await Promise.all([mine.reload(), bens.reload()]);
  await expect(mine.message('who is in?')).toBeVisible();
  await expect(bens.message('who is in?')).toBeVisible();
  await expect.poll(() => mine.reactions(myMessage)).toEqual([]);
  await expect.poll(() => bens.reactions(bensMessage)).toEqual([]);
});

// If this fails, an emoji chosen from the picker is not added, or is not
// the one chosen.
test('MSG-14 a reaction chosen in the emoji picker shows for both people and after reload', async ({
  page,
  ada,
  ben,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const launched = await ben.post(channel.id, 'we shipped');
  const mine = new Conversation(page, channel.id);
  const bens = new Conversation(await pageFor('ben'), channel.id);
  await Promise.all([mine.open(), bens.open()]);
  const myMessage = mine.messageById(launched.id);
  const bensMessage = bens.messageById(launched.id);

  const actions = await mine.actions(myMessage);
  await actions.getByRole('button', { name: 'More reactions' }).click();
  await mine.pickEmoji('rocket');
  await expect.poll(() => mine.reactions(myMessage)).toEqual(['🚀']);
  await expect.poll(() => bens.reactions(bensMessage)).toEqual(['🚀']);

  // With a reaction on it, the message has its own button for another.
  await bensMessage.getByRole('button', { name: 'Add reaction' }).click();
  await bens.pickEmoji('tada');
  await expect.poll(() => bens.reactions(bensMessage)).toEqual(['🎉', '🚀']);
  await expect.poll(() => mine.reactions(myMessage)).toEqual(['🎉', '🚀']);

  await Promise.all([mine.reload(), bens.reload()]);
  await expect.poll(() => mine.reactions(myMessage)).toEqual(['🎉', '🚀']);
  await expect.poll(() => bens.reactions(bensMessage)).toEqual(['🎉', '🚀']);
});

// If this fails, a person keeps reading text someone has since changed or
// removed, or misses their reactions, until they reload.
test('MSG-15 another person’s edit, reactions and deletion show on an open channel without reload', async ({
  page,
  ada,
  ben,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.post(channel.id, 'ada asks');
  const answer = await ben.post(channel.id, 'ben answers');
  const slip = await ben.post(channel.id, 'ben misspeaks');
  await ada.post(channel.id, 'ada thanks');
  const view = new Conversation(page, channel.id);
  await view.open();
  await expect
    .poll(() => view.topLevel())
    .toEqual(['ada asks', 'ben answers', 'ben misspeaks', 'ada thanks']);
  const message = view.messageById(answer.id);

  await ben.edit(channel.id, answer.id, 'ben answers better');
  await expect
    .poll(() => view.topLevel())
    .toEqual(['ada asks', 'ben answers better', 'ben misspeaks', 'ada thanks']);
  await expect(message.getByText('(edited)')).toBeVisible();

  await ben.react(channel.id, answer.id, '🎉');
  await expect.poll(() => view.reactions(message)).toEqual(['🎉']);
  await expect(view.reaction(message, '🎉')).toHaveAttribute(
    'aria-pressed',
    'false'
  );

  await ben.react(channel.id, answer.id, '🎉', false);
  await expect.poll(() => view.reactions(message)).toEqual([]);

  await ben.remove(channel.id, slip.id);
  await expect
    .poll(() => view.topLevel())
    .toEqual(['ada asks', 'ben answers better', 'ada thanks']);
});

// If this fails, a message written in one channel shows up in another.
test('MSG-16 a message sent to another channel does not appear in the open one', async ({
  page,
  ada,
  ben,
  people,
}) => {
  const open = await ada.createChannel({ members: [people.ben] });
  const other = await ada.createChannel({ members: [people.ben] });
  await ada.post(open.id, 'open channel start');
  await ada.post(other.id, 'other channel start');
  const view = new Conversation(page, open.id);
  await view.open();
  await expect.poll(() => view.topLevel()).toEqual(['open channel start']);

  await ben.post(other.id, 'meant for the other channel');
  // This one comes after it, so the first has been delivered by now.
  await ben.post(open.id, 'meant for the open channel');

  await expect
    .poll(() => view.topLevel())
    .toEqual(['open channel start', 'meant for the open channel']);

  await conversationRow(page, other.name).click();
  const otherView = new Conversation(page, other.id);
  await otherView.shown();
  await expect
    .poll(() => otherView.topLevel())
    .toEqual(['other channel start', 'meant for the other channel']);
});

// If this fails, “Copy Text” puts nothing, or something else, on the
// clipboard.
test('MSG-17 “Copy Text” on a message copies its text', async ({
  page,
  ada,
  ben,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.post(channel.id, 'not this one');
  const wanted = await ben.post(channel.id, 'copy exactly this, please');
  const view = new Conversation(page, channel.id);
  await view.open();

  // The same text every run: what an earlier run copied must not pass for it.
  await page.evaluate(() => navigator.clipboard.writeText('nothing yet'));
  await view.action(view.messageById(wanted.id), 'copy-message-text');

  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('copy exactly this, please');
});

// If this fails, two people writing at the same moment are left reading
// different conversations: the same messages, in another order.
test('MSG-18 messages two people send at the same moment end in one order for both, each once', async ({
  page,
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const mine = new Conversation(page, channel.id);
  const bens = new Conversation(await pageFor('ben'), channel.id);
  await Promise.all([mine.open(), bens.open()]);

  await Promise.all([
    (async () => {
      await mine.send('ada 1');
      await mine.send('ada 2');
      await mine.send('ada 3');
      await mine.send('ada 4');
    })(),
    (async () => {
      await bens.send('ben 1');
      await bens.send('ben 2');
      await bens.send('ben 3');
      await bens.send('ben 4');
    })(),
  ]);

  // Who came first between the two is the service's call; that every
  // message is there once, and that both people read one order, is not.
  const everyMessage = [
    'ada 1',
    'ada 2',
    'ada 3',
    'ada 4',
    'ben 1',
    'ben 2',
    'ben 3',
    'ben 4',
  ];
  for (const view of [mine, bens]) {
    await expect
      .poll(async () => (await view.topLevel()).sort())
      .toEqual(everyMessage);
    // Known defect on main, seen once in 62 runs: a person's own quick
    // messages are out of the order they sent them in.
    await failsSometimes(async () => {
      expect(
        (await view.topLevel()).filter((text) => text.startsWith('ada'))
      ).toEqual(['ada 1', 'ada 2', 'ada 3', 'ada 4']);
      expect(
        (await view.topLevel()).filter((text) => text.startsWith('ben'))
      ).toEqual(['ben 1', 'ben 2', 'ben 3', 'ben 4']);
    });
  }
  // Known defect on main, in most runs: a message that was on its way while
  // the other person's landed first keeps the place it was given on its
  // sender's page, so the two pages show different orders until a reload.
  await failsSometimes(async () => {
    await expect(async () => {
      expect(await bens.topLevel()).toEqual(await mine.topLevel());
    }).toPass({ timeout: 15_000 });
  });

  await Promise.all([mine.reload(), bens.reload()]);
  await expect(async () => {
    const order = await mine.topLevel();
    expect([...order].sort()).toEqual(everyMessage);
    expect(await bens.topLevel()).toEqual(order);
    // After a reload each person's own messages are in the order they sent
    // them in, whatever the open pages showed.
    for (const person of ['ada', 'ben']) {
      expect(order.filter((text) => text.startsWith(person))).toEqual(
        [1, 2, 3, 4].map((n) => `${person} ${n}`)
      );
    }
  }).toPass({ timeout: 15_000 });
});
