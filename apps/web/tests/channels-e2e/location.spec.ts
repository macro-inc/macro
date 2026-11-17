import { ChannelView } from './harness/channel';
import { expect, knownDefect, test } from './harness/fixtures';
import { HISTORY_LENGTH, historyText } from './harness/history';

// If this fails, a link to a message opens the channel somewhere else, or
// does not mark the message it was for.
test('NAV-01 a link to a recent message opens the channel on that message and marks it', async ({
  page,
  history,
}) => {
  const view = new ChannelView(page, history.id);
  const target = history.messages[HISTORY_LENGTH - 6];
  await view.noteMarkedMessages();
  await view.open({ messageId: target.id });

  const row = view.messageById(target.id);
  await expect(row).toBeInViewport();
  await expect(row).toContainText(target.content);
  await view.expectMarked(target.id);
});

// If this fails, a link to an old message does not reach it, or shows it
// among the wrong neighbours.
test('NAV-02 a link to an old message, pages back, shows it between its neighbours', async ({
  page,
  history,
}) => {
  const view = new ChannelView(page, history.id);
  const target = history.messages[14];
  await view.noteMarkedMessages();
  await view.open({ messageId: target.id });

  const row = view.messageById(target.id);
  await expect(row).toBeInViewport();
  await view.expectMarked(target.id);

  const texts = await view.texts();
  const at = texts.indexOf(historyText(15));
  expect(texts.slice(at - 3, at + 4)).toEqual(
    [12, 13, 14, 15, 16, 17, 18].map(historyText)
  );
  await expect(view.message(historyText(HISTORY_LENGTH))).toHaveCount(0);
});

// If this fails, a link to a reply does not open its thread, or lands on
// another reply.
test('NAV-03 a link to a reply deep in an old thread opens the thread on that reply', async ({
  page,
  history,
}) => {
  const view = new ChannelView(page, history.id);
  const reply = history.oldThread.replies[11];
  await view.noteMarkedMessages();
  await view.open({
    messageId: reply.id,
    threadId: history.oldThread.root.id,
  });

  const row = view.messageById(reply.id);
  await expect(row).toBeInViewport();
  await expect(row).toContainText('old reply 12');
  await view.expectMarked(reply.id);

  const replies = await view.replyTexts(history.oldThread.root.id);
  const at = replies.indexOf('old reply 12');
  expect(replies.slice(at - 1, at + 2)).toEqual([
    'old reply 11',
    'old reply 12',
    'old reply 13',
  ]);
});

// If this fails, a link to a message that does not exist leaves the person
// on a blank or broken channel instead of telling them and showing the latest.
test('NAV-04 a link to a message that does not exist says so and shows the latest messages', async ({
  page,
  ada,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const [, last] = await ada.postAll(channel.id, ['kept one', 'kept two']);

  const view = new ChannelView(page, channel.id);
  await view.open({
    messageId: '01900000-0000-7000-8000-000000000000',
    unwaited: true,
  });

  await expect(page.getByText('Message no longer available')).toBeVisible();
  await view.shown();
  await view.expectEndsWith(['kept one', 'kept two']);
  await expect(view.messageById(last.id)).toBeInViewport();
});

// If this fails, reading on from an old message skips or repeats messages
// on the way to the present, or never gets there.
test('NAV-05 reading forward from an old message reaches the latest with nothing missing or repeated', async ({
  page,
  history,
}) => {
  // Known defect on main: when the page that reaches the present arrives,
  // the list jumps to its end and the messages between are never shown.
  // Remove this line when that is fixed; the test then says so by failing.
  knownDefect('both');
  test.setTimeout(240_000);
  const view = new ChannelView(page, history.id);
  await view.open({ messageId: history.messages[14].id });
  await expect(view.messageById(history.messages[14].id)).toBeInViewport();

  const read = await view.readTo(historyText(HISTORY_LENGTH), 'forward');

  const from = history.texts.indexOf(read[0]);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(from).toBeLessThanOrEqual(14);
  expect(read).toEqual(history.texts.slice(from));
});

// If this fails, a person who followed a link into the past has no way
// back to the present.
test('NAV-06 scrolling down from an old message offers “Scroll to bottom”, which returns to the latest messages', async ({
  page,
  history,
}) => {
  const view = new ChannelView(page, history.id);
  await view.open({ messageId: history.messages[14].id });
  await expect(view.messageById(history.messages[14].id)).toBeInViewport();

  await (await view.scrollDownUntilOffered()).click();

  await expect(view.message(historyText(HISTORY_LENGTH))).toBeInViewport();
  await view.expectEndsWith(history.texts.slice(-5));
  await view.expectAtBottom();
});

// If this fails, the link a person copies from a message does not lead
// back to it.
test('NAV-07 “Copy link” on a message gives a link that opens the channel on it', async ({
  page,
  history,
}) => {
  const view = new ChannelView(page, history.id);
  await view.noteMarkedMessages();
  await view.open();
  const target = history.messages[HISTORY_LENGTH - 4];
  await view.action(view.messageById(target.id), 'copy-link');
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain(target.id);
  const link = await page.evaluate(() => navigator.clipboard.readText());

  // The link is opened from elsewhere in the app, as a pasted link is.
  await page.goto('/app/channels');
  await page.goto(link);

  await view.shown();
  const row = view.messageById(target.id);
  await expect(row).toBeInViewport();
  await view.expectMarked(target.id);
});
