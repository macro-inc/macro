import { ChannelView } from './harness/channel';
import {
  couldNotLoad,
  expectShown,
  findRow,
  loseConnectionAt,
  openFromList,
  openOffline,
  readAndReturn,
  shown,
  startAfresh,
} from './harness/device';
import {
  expect,
  failsSometimes,
  knownDefect,
  LOCAL_SYNC_BUILD,
  test,
} from './harness/fixtures';
import { historyText } from './harness/history';
import { Conversation } from './harness/messages';
import {
  codeFetched,
  goOffline,
  goOfflineAtOnce,
  goOnline,
  holdDeviceBack,
  slowLink,
} from './harness/network';

// What a device shows of a channel with no connection, or with a very slow
// one. Only a build that keeps channels on the device does any of this.
test.skip(
  !LOCAL_SYNC_BUILD,
  'channels are kept on the device only with the flag'
);

const WHOLE = [
  'one, edited',
  'This message was deleted.',
  '  > a reply',
  'three [👍]',
  'four',
];

/** A short channel with an edit, a deletion, a reply and a reaction in it. */
async function shortChannel(
  ada: import('./harness/api').Api,
  ben: import('./harness/api').Api
) {
  const channel = await ada.createChannel({ members: [ben.person] });
  const elsewhere = await ada.createChannel({ members: [ben.person] });
  await ada.post(elsewhere.id, 'elsewhere');
  const one = await ada.post(channel.id, 'one');
  const two = await ben.post(channel.id, 'two');
  const three = await ada.post(channel.id, 'three');
  await ada.edit(channel.id, one.id, 'one, edited');
  await ada.post(channel.id, 'a reply', { threadId: two.id });
  await ben.remove(channel.id, two.id);
  await ben.react(channel.id, three.id, '👍');
  await ada.post(channel.id, 'four');
  return { channel, elsewhere };
}

// If this fails, a channel the person has read does not open without a
// connection, or opens with edits, deletions, replies or reactions missing.
test('OFF-01 a channel the person has read opens whole with no connection', async ({
  pageFor,
  ada,
  ben,
}) => {
  const { channel, elsewhere } = await shortChannel(ada, ben);
  const page = await pageFor('ben');
  const view = await readAndReturn(page, channel, elsewhere);
  await expectShown(view, WHOLE);
  await startAfresh(page, elsewhere);

  const offline = await openOffline(page, channel);

  await expectShown(offline, WHOLE);
});

// If this fails, a channel the device has never held shows something other
// than a plain statement that it cannot load, or stays that way once the
// connection is back.
test('OFF-02 a channel the device has never held says it cannot load offline, and loads when the connection is back', async ({
  pageFor,
  ada,
  ben,
}) => {
  // Product defect, on a build that keeps channels on the device: with no
  // connection the channel goes on loading and never says it cannot load.
  knownDefect('on');
  const { elsewhere } = await shortChannel(ada, ben);
  const page = await pageFor('ben');
  await new Conversation(page, elsewhere.id).open();
  // Left alone, a device fetches a channel with something unread in it, so
  // this one is made, and the connection lost, with no time between.
  await codeFetched(page);
  const late = await ada.createChannel({ members: [ben.person] });
  await ada.post(late.id, 'made just now');
  await findRow(page, late);

  await goOfflineAtOnce(page.context());
  await page.getByText(late.name).first().click();
  await expect(couldNotLoad(page)).toBeVisible();
  await expect(page.getByText('made just now')).toHaveCount(0);

  await goOnline(page.context());
  await page.getByRole('button', { name: 'Retry' }).click();
  await expectShown(new Conversation(page, late.id), ['made just now']);
});

// If this fails, a channel the device holds waits for a slow connection
// before showing anything, or never shows what the slow answer brought.
test('OFF-03 on a very slow connection a held channel shows at once, and what changed meanwhile shows when the answer arrives', async ({
  pageFor,
  ada,
  ben,
}) => {
  const { channel, elsewhere } = await shortChannel(ada, ben);
  const page = await pageFor('ben');
  const view = await readAndReturn(page, channel, elsewhere);
  await expectShown(view, WHOLE);
  await startAfresh(page, elsewhere);
  await findRow(page, channel);
  await ada.post(channel.id, 'five');

  const restore = await slowLink(page, 8000);
  await openFromList(page, channel);
  await expect
    .poll(() => shown(view), { timeout: 4000 })
    .toEqual(expect.arrayContaining(WHOLE));
  await restore();

  await expectShown(view, [...WHOLE, 'five']);
});

// If this fails, the older messages a person read through cannot be read
// again without a connection.
test('OFF-04 messages read far back in a long channel can be scrolled through again with no connection', async ({
  pageFor,
  ada,
  ben,
  history,
}) => {
  const { elsewhere } = await shortChannel(ada, ben);
  const page = await pageFor('ben');
  const view = new Conversation(page, history.id);
  await view.open();
  await view.readTo('history 001', 'back');
  await startAfresh(page, elsewhere);

  await loseConnectionAt(page, history);
  // Defect, in some runs: the channel cannot be loaded.
  await failsSometimes(async () => {
    const offline = await openFromList(page, history);
    await offline.expectEndsWith(['history 229', 'history 230']);
    await offline.readTo('history 001', 'back');
    await expect(offline.message('history 001')).toBeVisible();
    await expect(offline.message('history 002')).toBeVisible();
  });
});

// If this fails, a person offline at the oldest message their device holds
// is shown an error or an empty channel instead of what they have.
test('OFF-05 scrolling past the oldest held message with no connection keeps what is held on screen', async ({
  pageFor,
  ada,
  ben,
}) => {
  test.setTimeout(180_000);
  const { elsewhere } = await shortChannel(ada, ben);
  const channel = await ada.createChannel({ members: [ben.person] });
  await ada.postAll(
    channel.id,
    Array.from(
      { length: 130 },
      (_, index) => `line ${String(index + 1).padStart(3, '0')}`
    )
  );
  const page = await pageFor('ben');
  const view = await readAndReturn(page, channel, elsewhere);
  await view.expectEndsWith(['line 129', 'line 130']);
  await startAfresh(page, elsewhere);

  const offline = await openOffline(page, channel);
  await offline.expectEndsWith(['line 129', 'line 130']);
  await offline.readTo('line 082', 'back');
  await offline.wheel(-20000);
  await offline.wheel(-20000);

  await expect(couldNotLoad(page)).toHaveCount(0);
  await expect(offline.message('line 082')).toBeVisible();
  await expect(offline.message('line 001')).toHaveCount(0);
});

// If this fails, the replies of a thread the person read do not show
// without a connection.
test('OFF-06 a thread read while connected shows its replies with no connection, a long one included', async ({
  pageFor,
  ada,
  ben,
}) => {
  const channel = await ada.createChannel({ members: [ben.person] });
  const elsewhere = await ada.createChannel({ members: [ben.person] });
  await ada.post(elsewhere.id, 'elsewhere');
  const root = await ada.post(channel.id, 'root');
  const replies = Array.from(
    { length: 24 },
    (_, index) => `reply ${String(index + 1).padStart(2, '0')}`
  );
  for (const text of replies) {
    await ben.post(channel.id, text, { threadId: root.id });
  }
  await ada.post(channel.id, 'after');
  const page = await pageFor('ben');
  const view = await readAndReturn(page, channel, elsewhere);
  await view.hiddenReplies(root.id).click();
  await expect.poll(() => view.replies(root.id)).toEqual(replies);
  await startAfresh(page, elsewhere);

  const offline = await openOffline(page, channel);
  await offline.hiddenReplies(root.id).click();

  await expect.poll(() => offline.replies(root.id)).toEqual(replies);
});

// If this fails, a thread whose replies the device never fetched shows an
// error, or nothing, where the replies it does hold should be.
test('OFF-07 a long thread never opened, opened with no connection, shows every reply or says that there are more', async ({
  pageFor,
  ada,
  ben,
}) => {
  const channel = await ada.createChannel({ members: [ben.person] });
  const elsewhere = await ada.createChannel({ members: [ben.person] });
  await ada.post(elsewhere.id, 'elsewhere');
  const root = await ada.post(channel.id, 'root');
  const replies = Array.from(
    { length: 24 },
    (_, index) => `reply ${String(index + 1).padStart(2, '0')}`
  );
  for (const text of replies) {
    await ben.post(channel.id, text, { threadId: root.id });
  }
  const page = await pageFor('ben');
  const view = await readAndReturn(page, channel, elsewhere);
  await expect(view.hiddenReplies(root.id)).toBeVisible();
  const before = await view.replies(root.id);
  await startAfresh(page, elsewhere);

  const offline = await openOffline(page, channel);
  await expect.poll(() => offline.replies(root.id)).toEqual(before);
  await offline.hiddenReplies(root.id).click();

  // Every reply, or the replies it has and a count of the ones it has not.
  await expect(couldNotLoad(page)).toHaveCount(0);
  await expect
    .poll(async () => {
      const drawn = await offline.replies(root.id);
      const more = await offline.hiddenReplies(root.id).isVisible();
      return drawn.length === replies.length || (more && drawn.length > 0);
    })
    .toBe(true);
});

// If this fails, a team's owner loses the whole app, not just one channel,
// when they open a channel with no connection.
test('OFF-08 a team owner opening a held channel with no connection sees the channel', async ({
  page,
  ada,
  ben,
}) => {
  const { channel, elsewhere } = await shortChannel(ada, ben);
  const view = await readAndReturn(page, channel, elsewhere);
  await expectShown(view, WHOLE);
  await startAfresh(page, elsewhere);

  const offline = await openOffline(page, channel);

  await expectShown(offline, WHOLE);
  await expect(page.getByText('Something went terribly wrong')).toHaveCount(0);
});

// If this fails, a channel a person glanced at and left is not on their
// device: without a connection it does not open at all.
test('OFF-09 a channel left as soon as its messages showed opens with no connection', async ({
  pageFor,
  ada,
  ben,
}) => {
  const { channel, elsewhere } = await shortChannel(ada, ben);
  const page = await pageFor('ben');
  const view = new Conversation(page, channel.id);
  await view.open();
  await expectShown(view, WHOLE);
  await startAfresh(page, elsewhere);

  await findRow(page, channel);
  await goOffline(page.context());
  await page.getByText(channel.name).first().click();

  await expectShown(view, WHOLE);
  await expect(couldNotLoad(page)).toHaveCount(0);
});

// If this fails, a message a person watched arrive is missing from the
// channel when their device next has to show it without a connection.
test('OFF-10 a message that arrived while the channel was open is there when the channel opens with no connection', async ({
  pageFor,
  ada,
  ben,
}) => {
  const { channel, elsewhere } = await shortChannel(ada, ben);
  const page = await pageFor('ben');
  const view = await readAndReturn(page, channel, elsewhere);
  await ada.post(channel.id, 'five');
  await expectShown(view, [...WHOLE, 'five']);
  await startAfresh(page, elsewhere);

  const offline = await openOffline(page, channel);

  await expectShown(offline, [...WHOLE, 'five']);
});

// If this fails, a person offline is told that a new version of the app is
// out and asked to reload, which without a connection loses the app.
test('OFF-11 opening a held channel with no connection does not say that a new version is out', async ({
  pageFor,
  ada,
  ben,
}) => {
  const { channel, elsewhere } = await shortChannel(ada, ben);
  const page = await pageFor('ben');
  const view = await readAndReturn(page, channel, elsewhere);
  await expectShown(view, WHOLE);
  await startAfresh(page, elsewhere);

  const offline = await openOffline(page, channel);
  await expectShown(offline, WHOLE);
  await offline.send('written offline');
  await expectShown(offline, [...WHOLE, 'written offline']);

  await expect(page.getByText('New version available')).toHaveCount(0);
});

// If this fails, a person with many channels cannot open, with no
// connection, a channel their device holds once a hundred others are newer.
test('OFF-13 a channel read while connected opens with no connection after a hundred and twenty newer ones were made', async ({
  pageFor,
  dee,
}) => {
  test.setTimeout(240_000);
  // Dee's, so that the other tests' people keep under a hundred channels.
  const page = await pageFor('dee');
  const elsewhere = await dee.createChannel({});
  await dee.post(elsewhere.id, 'elsewhere');
  const old = await dee.createChannel({});
  await dee.post(old.id, 'in the old channel');
  const view = new ChannelView(page, old.id);
  await view.open();
  await expectShown(view, ['in the old channel']);
  await findRow(page, elsewhere);
  await openFromList(page, elsewhere);
  await page.goBack();
  await expectShown(view, ['in the old channel']);
  for (let made = 0; made < 120; made += 1) {
    await dee.createChannel({});
  }
  await dee.post(elsewhere.id, 'elsewhere again');
  await startAfresh(page, elsewhere);

  await goOffline(page.context());
  await page.goBack();

  await view.shown();
  await expectShown(view, ['in the old channel']);
});

// If this fails, what a person read just before the page was loaded again, in the second or
// two a new page takes to start keeping channels, is not on their device:
// without a connection the thread they read shows no replies.
test('OFF-14 a thread read on a page that was left before the device kept it shows its replies with no connection', async ({
  pageFor,
  ada,
  ben,
}) => {
  const channel = await ada.createChannel({ members: [ben.person] });
  const elsewhere = await ada.createChannel({ members: [ben.person] });
  await ada.post(elsewhere.id, 'elsewhere');
  const root = await ada.post(channel.id, 'root');
  const replies = ['reply 1', 'reply 2', 'reply 3', 'reply 4', 'reply 5'];
  for (const text of replies) {
    await ben.post(channel.id, text, { threadId: root.id });
  }
  const page = await pageFor('ben');
  // The page that reads the thread never gets to keep it.
  const letDeviceStart = await holdDeviceBack(page.context());
  const view = new Conversation(page, channel.id);
  await view.open();
  await view.hiddenReplies(root.id).click();
  await expect.poll(() => view.replies(root.id)).toEqual(replies);
  // A device fetches the channels a person had open lately by itself, but
  // not their threads: only the thread shows what the lost page left behind.
  await new Conversation(page, elsewhere.id).open();
  await letDeviceStart();

  const offline = await openOffline(page, channel);
  await offline.hiddenReplies(root.id).click();

  await expect.poll(() => offline.replies(root.id)).toEqual(replies);
});

// If this fails, a person cannot go back to an old message they followed a
// link to while connected: the device shows other messages, or none.
test('OFF-12 going back to a link to an old message read while connected shows it between its neighbours with no connection', async ({
  page,
  ada,
  ben,
  history,
}) => {
  // Product defect, on a build that keeps channels on the device: gone back
  // to with no connection, the link goes on loading and shows no message.
  knownDefect('on');
  const elsewhere = await ada.createChannel({ members: [ben.person] });
  await ada.post(elsewhere.id, 'elsewhere');
  const target = history.messages[14];
  const view = new ChannelView(page, history.id);
  await view.open({ messageId: target.id });
  await expect(view.messageById(target.id)).toBeInViewport();
  // Read twice, as a channel is for the other tests of what a device holds
  // (OFF-09): this one is about the place in the channel.
  await findRow(page, elsewhere);
  await openFromList(page, elsewhere);
  await page.goBack();
  await expect(view.messageById(target.id)).toBeInViewport();
  await startAfresh(page, elsewhere);

  await goOffline(page.context());
  // Back is how a browser follows a link with no connection: a link in a
  // message opens a new tab, which cannot load.
  await page.goBack();

  await view.shown();
  await expect(view.messageById(target.id)).toBeInViewport();
  const texts = await view.texts();
  const at = texts.indexOf(historyText(15));
  expect(texts.slice(at - 3, at + 4)).toEqual(
    [12, 13, 14, 15, 16, 17, 18].map(historyText)
  );
});
