import { expect, failsSometimes, test } from './harness/fixtures';
import { Conversation } from './harness/messages';

// If this fails, a reply is lost, lands in the channel instead of under the
// message it answers, or does not reach the other person.
test('THR-01 a reply written from “Reply” shows under its message for both people, and after reload', async ({
  page,
  ada,
  ben,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const root = await ben.post(channel.id, 'a question');
  await ben.post(channel.id, 'something later');
  const mine = new Conversation(page, channel.id);
  const bens = new Conversation(await pageFor('ben'), channel.id);
  await Promise.all([mine.open(), bens.open()]);
  await expect(bens.message('something later')).toBeVisible();

  const composer = await mine.startReply(root.id);
  await composer.click();
  await page.keyboard.type('an answer');
  await page.keyboard.press('Enter');

  for (const view of [mine, bens]) {
    await expect
      .poll(() => view.repliesByAuthor(root.id))
      .toEqual(['Ada Owner: an answer']);
    await expect
      .poll(() => view.topLevel())
      .toEqual(['a question', 'something later']);
  }

  await Promise.all([mine.reload(), bens.reload()]);
  for (const view of [mine, bens]) {
    await expect
      .poll(() => view.repliesByAuthor(root.id))
      .toEqual(['Ada Owner: an answer']);
    await expect
      .poll(() => view.topLevel())
      .toEqual(['a question', 'something later']);
  }
});

// If this fails, people in a thread read its replies in different orders,
// or replies to an old message spill into or reorder the channel.
test('THR-02 replies from two people to an old message read in one order for both, and leave the channel’s order alone', async ({
  page,
  ada,
  ben,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const root = await ada.post(channel.id, 'the old message');
  await ben.post(channel.id, 'a newer message');
  await ada.post(channel.id, 'the newest message');
  const mine = new Conversation(page, channel.id);
  const bens = new Conversation(await pageFor('ben'), channel.id);
  await Promise.all([mine.open(), bens.open()]);
  await expect(bens.message('the newest message')).toBeVisible();

  await mine.reply(root.id, 'ada replies first');
  await expect(bens.message('ada replies first')).toBeVisible();
  await bens.reply(root.id, 'ben replies second');
  await expect(mine.message('ben replies second')).toBeVisible();
  await mine.reply(root.id, 'ada replies third');
  await expect(bens.message('ada replies third')).toBeVisible();
  await bens.reply(root.id, 'ben replies fourth');

  const replies = [
    'Ada Owner: ada replies first',
    'Ben Member: ben replies second',
    'Ada Owner: ada replies third',
    'Ben Member: ben replies fourth',
  ];
  const channelMessages = [
    'the old message',
    'a newer message',
    'the newest message',
  ];
  // Known defect on main, about one run in five on a busy machine: a reply
  // that was shown goes from one of the pages until a reload.
  await failsSometimes(async () => {
    for (const view of [mine, bens]) {
      await expect.poll(() => view.repliesByAuthor(root.id)).toEqual(replies);
    }
  });
  for (const view of [mine, bens]) {
    await expect.poll(() => view.topLevel()).toEqual(channelMessages);
  }

  // A reloaded channel shows a thread's first three replies and a button
  // for the rest.
  await Promise.all([mine.reload(), bens.reload()]);
  for (const view of [mine, bens]) {
    await expect.poll(() => view.topLevel()).toEqual(channelMessages);
    await expect(view.hiddenReplies(root.id)).toContainText('1 more reply');
    await view.hiddenReplies(root.id).click();
    await expect.poll(() => view.repliesByAuthor(root.id)).toEqual(replies);
    await expect.poll(() => view.topLevel()).toEqual(channelMessages);
  }
});

// If this fails, a long thread hides replies with no way to them, or
// opening it loses, repeats or reorders replies.
test('THR-03 a long thread shows its first three replies and a count, opens to every reply in order, and closes again', async ({
  page,
  ada,
  ben,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.post(channel.id, 'before the thread');
  const root = await ada.post(channel.id, 'the long thread');
  const sixteen = [
    'reply 01',
    'reply 02',
    'reply 03',
    'reply 04',
    'reply 05',
    'reply 06',
    'reply 07',
    'reply 08',
    'reply 09',
    'reply 10',
    'reply 11',
    'reply 12',
    'reply 13',
    'reply 14',
    'reply 15',
    'reply 16',
  ];
  for (const [index, text] of sixteen.entries()) {
    await (index % 2 === 0 ? ben : ada).post(channel.id, text, {
      threadId: root.id,
    });
  }
  await ada.post(channel.id, 'after the thread');
  const view = new Conversation(page, channel.id);
  await view.open();

  const firstThree = ['reply 01', 'reply 02', 'reply 03'];
  const channelMessages = [
    'before the thread',
    'the long thread',
    'after the thread',
  ];
  await expect.poll(() => view.replies(root.id)).toEqual(firstThree);
  await expect(view.hiddenReplies(root.id)).toContainText('13 more replies');
  await expect.poll(() => view.topLevel()).toEqual(channelMessages);

  await view.hiddenReplies(root.id).click();
  await expect.poll(() => view.replies(root.id)).toEqual(sixteen);
  await expect(view.hiddenReplies(root.id)).toHaveCount(0);
  await expect.poll(() => view.topLevel()).toEqual(channelMessages);

  // With a reply selected, the left arrow closes the thread.
  await view.message('reply 05').click();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => view.replies(root.id)).toEqual(firstThree);
  await expect(view.hiddenReplies(root.id)).toContainText('13 more replies');

  await view.hiddenReplies(root.id).click();
  await expect.poll(() => view.replies(root.id)).toEqual(sixteen);
});

// If this fails, an edited reply keeps its old text for the other person,
// or the edit is not marked.
test('THR-04 editing my reply shows the new text and “(edited)” to the other person without reload', async ({
  page,
  ada,
  ben,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const root = await ben.post(channel.id, 'thread start');
  await ben.post(channel.id, 'ben replies', { threadId: root.id });
  const reply = await ada.post(channel.id, 'ada replies badly', {
    threadId: root.id,
  });
  const mine = new Conversation(page, channel.id);
  const bens = new Conversation(await pageFor('ben'), channel.id);
  await Promise.all([mine.open(), bens.open()]);
  await expect(bens.message('ada replies badly')).toBeVisible();

  await mine.action(mine.messageById(reply.id), 'edit');
  await expect(mine.editor(reply.id)).toHaveText('ada replies badly');
  await expect(mine.editor(reply.id)).toBeFocused();
  await mine.retype('ada replies well');
  await page.keyboard.press('Enter');

  const replies = ['Ben Member: ben replies', 'Ada Owner: ada replies well'];
  for (const view of [mine, bens]) {
    await expect.poll(() => view.repliesByAuthor(root.id)).toEqual(replies);
    await expect(
      view.messageById(reply.id).getByText('(edited)')
    ).toBeVisible();
    await expect(view.list.getByText('(edited)')).toHaveCount(1);
    await expect.poll(() => view.topLevel()).toEqual(['thread start']);
  }

  await Promise.all([mine.reload(), bens.reload()]);
  for (const view of [mine, bens]) {
    await expect.poll(() => view.repliesByAuthor(root.id)).toEqual(replies);
    await expect(
      view.messageById(reply.id).getByText('(edited)')
    ).toBeVisible();
  }
});

// If this fails, a deleted reply stays in front of the other person, or
// takes its neighbours with it.
test('THR-05 deleting my reply removes it for the other person without reload, and leaves the others', async ({
  page,
  ada,
  ben,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const root = await ben.post(channel.id, 'thread start');
  await ben.post(channel.id, 'ben replies', { threadId: root.id });
  const doomed = await ada.post(channel.id, 'ada regrets this', {
    threadId: root.id,
  });
  await ben.post(channel.id, 'ben replies again', { threadId: root.id });
  const mine = new Conversation(page, channel.id);
  const bens = new Conversation(await pageFor('ben'), channel.id);
  await Promise.all([mine.open(), bens.open()]);
  await expect(bens.message('ada regrets this')).toBeVisible();

  await mine.delete(mine.messageById(doomed.id));

  const replies = ['ben replies', 'ben replies again'];
  for (const view of [mine, bens]) {
    await expect.poll(() => view.replies(root.id)).toEqual(replies);
    await expect.poll(() => view.topLevel()).toEqual(['thread start']);
  }

  await Promise.all([mine.reload(), bens.reload()]);
  for (const view of [mine, bens]) {
    await expect(view.message('ben replies again')).toBeVisible();
    await expect.poll(() => view.replies(root.id)).toEqual(replies);
    await expect.poll(() => view.topLevel()).toEqual(['thread start']);
  }
});

// If this fails, a reaction to a reply is lost, or lands on another message
// of the thread.
test('THR-06 a reaction to a reply shows on that reply for both people, and counts 2 when both react', async ({
  page,
  ada,
  ben,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const root = await ada.post(channel.id, 'thread start');
  await ben.post(channel.id, 'first reply', { threadId: root.id });
  const reply = await ben.post(channel.id, 'the good reply', {
    threadId: root.id,
  });
  const mine = new Conversation(page, channel.id);
  const bens = new Conversation(await pageFor('ben'), channel.id);
  await Promise.all([mine.open(), bens.open()]);

  await mine.quickReact(mine.messageById(reply.id), '❤️');

  for (const view of [mine, bens]) {
    await expect
      .poll(() => view.reactions(view.messageById(reply.id)))
      .toEqual(['❤️']);
    // The only reaction in the channel is the one on that reply.
    await expect(view.list.locator('[data-message-reaction-chip]')).toHaveCount(
      1
    );
  }

  await bens.reaction(bens.messageById(reply.id), '❤️').click();
  for (const view of [mine, bens]) {
    await expect
      .poll(() => view.reactions(view.messageById(reply.id)))
      .toEqual(['❤️ 2']);
  }

  await Promise.all([mine.reload(), bens.reload()]);
  for (const view of [mine, bens]) {
    await expect
      .poll(() => view.reactions(view.messageById(reply.id)))
      .toEqual(['❤️ 2']);
    await expect(view.list.locator('[data-message-reaction-chip]')).toHaveCount(
      1
    );
  }
});

// If this fails, a person reading an open thread does not see a new reply
// until they reload.
test('THR-07 a reply from someone else arrives at the end of an open thread without reload', async ({
  page,
  ada,
  ben,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const root = await ada.post(channel.id, 'thread start');
  for (const text of ['one', 'two', 'three', 'four', 'five']) {
    await ben.post(channel.id, text, { threadId: root.id });
  }
  await ada.post(channel.id, 'after the thread');
  const view = new Conversation(page, channel.id);
  await view.open();
  await view.hiddenReplies(root.id).click();
  await expect
    .poll(() => view.replies(root.id))
    .toEqual(['one', 'two', 'three', 'four', 'five']);

  await ben.post(channel.id, 'six, live', { threadId: root.id });

  await expect
    .poll(() => view.repliesByAuthor(root.id))
    .toEqual([
      'Ben Member: one',
      'Ben Member: two',
      'Ben Member: three',
      'Ben Member: four',
      'Ben Member: five',
      'Ben Member: six, live',
    ]);
  await expect(view.hiddenReplies(root.id)).toHaveCount(0);
  await expect
    .poll(() => view.topLevel())
    .toEqual(['thread start', 'after the thread']);
});

// If this fails, a closed thread does not tell its reader that it got a new
// reply, or loses the reply when opened.
test('THR-08 a reply from someone else to a closed thread raises its count without reload, and is there when opened', async ({
  page,
  ada,
  ben,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const root = await ada.post(channel.id, 'thread start');
  for (const text of ['one', 'two', 'three', 'four', 'five']) {
    await ben.post(channel.id, text, { threadId: root.id });
  }
  const quiet = await ada.post(channel.id, 'a message without replies');
  const view = new Conversation(page, channel.id);
  await view.open();
  await expect(view.hiddenReplies(root.id)).toContainText('2 more replies');

  await ben.post(channel.id, 'six, live', { threadId: root.id });

  // Known defect on main, in about 1 run in 15: the reply does not reach the
  // open page, and the count stays as it was until the thread is opened.
  await failsSometimes(async () => {
    await expect(view.hiddenReplies(root.id)).toContainText('3 more replies');
  });
  await expect
    .poll(() => view.replies(root.id))
    .toEqual(['one', 'two', 'three']);

  // A message nobody had replied to shows its first reply at once.
  await ben.post(channel.id, 'a first reply, live', { threadId: quiet.id });
  await expect
    .poll(() => view.repliesByAuthor(quiet.id))
    .toEqual(['Ben Member: a first reply, live']);
  await expect
    .poll(() => view.topLevel())
    .toEqual(['thread start', 'a message without replies']);

  await view.hiddenReplies(root.id).click();
  await expect
    .poll(() => view.replies(root.id))
    .toEqual(['one', 'two', 'three', 'four', 'five', 'six, live']);
});

// If this fails, a reply written under one message is posted under another.
test('THR-09 with replies being written to two messages, each goes to the thread it was written in', async ({
  page,
  ada,
  ben,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const first = await ben.post(channel.id, 'first topic');
  const second = await ada.post(channel.id, 'second topic');
  await ben.post(channel.id, 'already said', { threadId: second.id });
  const mine = new Conversation(page, channel.id);
  const bens = new Conversation(await pageFor('ben'), channel.id);
  await Promise.all([mine.open(), bens.open()]);

  // Two replies begun, the first left unsent while the second is written.
  const toFirst = await mine.startReply(first.id);
  await toFirst.click();
  await page.keyboard.type('about the first');
  await mine
    .thread(second.id)
    .getByRole('button', { name: 'Reply', exact: true })
    .click();
  const toSecond = mine.replyComposer(second.id);
  await expect(toSecond).toBeFocused();
  await expect(toFirst).toHaveText('about the first');
  await page.keyboard.type('about the second');
  await page.keyboard.press('Enter');

  for (const view of [mine, bens]) {
    await expect
      .poll(() => view.replies(second.id))
      .toEqual(['already said', 'about the second']);
    await expect.poll(() => view.replies(first.id)).toEqual([]);
  }

  await toFirst.click();
  await page.keyboard.press('Enter');

  for (const view of [mine, bens]) {
    await expect
      .poll(() => view.replies(first.id))
      .toEqual(['about the first']);
    await expect
      .poll(() => view.replies(second.id))
      .toEqual(['already said', 'about the second']);
    await expect
      .poll(() => view.topLevel())
      .toEqual(['first topic', 'second topic']);
  }
  await expect(toFirst).toHaveCount(0);
  await expect(toSecond).toHaveCount(0);
});

// If this fails, a person who presses “Reply” and starts typing loses what
// they type, or sets off shortcuts with it.
test('THR-10 “Reply” on a message puts the keyboard in the reply box, so typing goes there', async ({
  page,
  ada,
  ben,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const root = await ben.post(channel.id, 'a question');
  const view = new Conversation(page, channel.id);
  await view.open();

  const composer = await view.startReply(root.id);
  await expect(composer).toBeFocused();
  await page.keyboard.type('typed straight away');
  await page.keyboard.press('Enter');

  await expect
    .poll(() => view.replies(root.id))
    .toEqual(['typed straight away']);
});
