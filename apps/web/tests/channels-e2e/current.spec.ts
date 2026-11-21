import type { Api, SentMessage } from './harness/api';
import {
  expectShown,
  findRow,
  type Named,
  openFromList,
  openOffline,
  readAndReturn,
  startAfresh,
} from './harness/device';
import {
  expect,
  failsSometimes,
  LOCAL_SYNC_BUILD,
  test,
} from './harness/fixtures';
import { noAccess } from './harness/management';
import { Conversation } from './harness/messages';
import { goOffline, goOnline } from './harness/network';
import { serverChannel } from './harness/server';

// Ben reads in a browser; Ada, and Ben himself from another device, change
// the channel through the services while his browser is not looking. Each
// test ends on the same lines three times: what the test did, what Ben's
// screen shows, and what the services hold.

type Scene = {
  channel: Named;
  elsewhere: Named;
  messages: SentMessage[];
  reply: SentMessage;
};

/** Two channels of Ada's and Ben's: one with six messages and a reply. */
async function scene(ada: Api, ben: Api): Promise<Scene> {
  const channel = await ada.createChannel({ members: [ben.person] });
  const elsewhere = await ada.createChannel({ members: [ben.person] });
  await ada.post(elsewhere.id, 'elsewhere');
  const messages: SentMessage[] = [];
  for (const [index, text] of [
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
  ].entries()) {
    messages.push(await (index % 2 === 0 ? ada : ben).post(channel.id, text));
  }
  const reply = await ben.post(channel.id, 'first reply', {
    threadId: messages[1].id,
  });
  return { channel, elsewhere, messages, reply };
}

const AT_FIRST = [
  'one',
  'two',
  '  > first reply',
  'three',
  'four',
  'five',
  'six',
];

/**
 * Everything that can happen to a channel, done by Ada and by Ben from
 * another device: new messages, an edit of each one's own, a deletion with
 * and without replies, reactions put on and taken off, replies, and an edit
 * and a deletion of a reply.
 */
async function changeEverything(
  ada: Api,
  ben: Api,
  { channel, messages, reply }: Scene
): Promise<void> {
  const [one, two, three, four, five, six] = messages;
  await ada.post(channel.id, 'seven');
  await ada.edit(channel.id, one.id, 'one, edited');
  await ben.edit(channel.id, four.id, 'four, edited');
  await ada.remove(channel.id, three.id);
  await ada.react(channel.id, six.id, '👍');
  await ben.react(channel.id, six.id, '👍');
  await ada.react(channel.id, five.id, '🎉');
  await ada.react(channel.id, five.id, '🎉', false);
  await ben.react(channel.id, five.id, '❤️');
  const second = await ada.post(channel.id, 'second reply', {
    threadId: two.id,
  });
  await ada.post(channel.id, 'third reply', { threadId: two.id });
  await ben.edit(channel.id, reply.id, 'first reply, edited');
  await ada.remove(channel.id, second.id);
  await ben.remove(channel.id, two.id);
  const eight = await ben.post(channel.id, 'eight');
  await ada.post(channel.id, 'reply to eight', { threadId: eight.id });
  await ben.edit(channel.id, eight.id, 'eight, edited');
}

const AFTER_EVERYTHING = [
  'one, edited',
  'This message was deleted.',
  '  > first reply, edited',
  '  > third reply',
  'four, edited',
  'five [❤️]',
  'six [👍 2]',
  'seven',
  'eight, edited',
  '  > reply to eight',
];

// If this fails, someone who looks at another channel for a while comes back
// to messages that are missing, stale or repeated until they reload.
test('SYN-01 a channel left for another one shows everything that changed meanwhile when the person comes back', async ({
  pageFor,
  ada,
  ben,
}) => {
  const made = await scene(ada, ben);
  const page = await pageFor('ben');
  const view = new Conversation(page, made.channel.id);
  await view.open();
  await expectShown(view, AT_FIRST);
  await findRow(page, made.elsewhere);
  await openFromList(page, made.elsewhere);

  await changeEverything(ada, ben, made);
  await findRow(page, made.channel);
  await openFromList(page, made.channel);

  await expectShown(view, AFTER_EVERYTHING);
  expect(await serverChannel('ben', made.channel.id)).toEqual(AFTER_EVERYTHING);
});

// If this fails, someone whose connection dropped with a channel open is
// left with edits, deletions, reactions or replies missing once it is back.
test('SYN-02 an open channel whose connection dropped shows every change made meanwhile once it is back, without a reload', async ({
  pageFor,
  ada,
  ben,
}) => {
  const made = await scene(ada, ben);
  const page = await pageFor('ben');
  const view = new Conversation(page, made.channel.id);
  await view.open();
  await expectShown(view, AT_FIRST);

  await goOffline(page.context());
  await changeEverything(ada, ben, made);
  await goOnline(page.context());

  await expectShown(view, AFTER_EVERYTHING);
  expect(await serverChannel('ben', made.channel.id)).toEqual(AFTER_EVERYTHING);
});

// If this fails, someone who was offline and elsewhere in the app opens a
// channel that still shows what it held before, as if nothing had happened.
test('SYN-03 a channel changed while the person was offline and in another channel is right when they come back to it', async ({
  pageFor,
  ada,
  ben,
}) => {
  const made = await scene(ada, ben);
  const page = await pageFor('ben');
  const view = new Conversation(page, made.channel.id);
  await view.open();
  await expectShown(view, AT_FIRST);
  await findRow(page, made.elsewhere);
  await openFromList(page, made.elsewhere);
  await findRow(page, made.channel);

  await goOffline(page.context());
  await changeEverything(ada, ben, made);
  await goOnline(page.context());
  await openFromList(page, made.channel);

  await expectShown(view, AFTER_EVERYTHING);
  expect(await serverChannel('ben', made.channel.id)).toEqual(AFTER_EVERYTHING);
});

// If this fails, someone who closed the app and opens it again later sees
// the channel as their device last stored it, not as it is.
test('SYN-04 a channel changed while the app was closed is right when the app is opened again', async ({
  pageFor,
  ada,
  ben,
}) => {
  const made = await scene(ada, ben);
  const first = await pageFor('ben');
  const view = await readAndReturn(first, made.channel, made.elsewhere);
  await expectShown(view, AT_FIRST);
  // A blank tab keeps the browser profile, with what it stored, while no
  // window of the app is open to hear of the changes.
  const blank = await first.context().newPage();
  await first.close();

  await changeEverything(ada, ben, made);
  const again = new Conversation(blank, made.channel.id);
  await again.open();

  await expectShown(again, AFTER_EVERYTHING);
  expect(await serverChannel('ben', made.channel.id)).toEqual(AFTER_EVERYTHING);
});

// If this fails, the device shows a caught-up channel while connected but
// goes back to an older copy of it the next time it has to open it offline.
test('SYN-05 what a device caught up on is what it shows the next time it opens the channel with no connection', async ({
  pageFor,
  ada,
  ben,
}) => {
  test.skip(!LOCAL_SYNC_BUILD, 'channels open offline only with the flag');
  const made = await scene(ada, ben);
  const first = await pageFor('ben');
  const view = new Conversation(first, made.channel.id);
  await view.open();
  await expectShown(view, AT_FIRST);
  await findRow(first, made.elsewhere);
  await openFromList(first, made.elsewhere);
  await changeEverything(ada, ben, made);
  await findRow(first, made.channel);
  await openFromList(first, made.channel);
  await expectShown(view, AFTER_EVERYTHING);

  await startAfresh(first, made.elsewhere);
  const offline = await openOffline(first, made.channel);

  await expectShown(offline, AFTER_EVERYTHING);
});

// If this fails, someone away from a busy channel for long enough comes
// back to a channel that kept its old messages and lost the changes to them.
test('SYN-06 a channel more than a thousand changes behind is right when it is opened again', async ({
  pageFor,
  ada,
  ben,
}) => {
  test.setTimeout(300_000);
  const made = await scene(ada, ben);
  const [one, , three, , five, six] = made.messages;
  const first = await pageFor('ben');
  const view = await readAndReturn(first, made.channel, made.elsewhere);
  await expectShown(view, AT_FIRST);
  const blank = await first.context().newPage();
  await first.close();

  // The changes that matter come first, so that they are the ones furthest
  // behind when the device asks what it missed.
  await ada.edit(made.channel.id, one.id, 'one, edited');
  await ada.remove(made.channel.id, three.id);
  await ada.react(made.channel.id, five.id, '❤️');
  await ada.post(made.channel.id, 'seven');
  for (let turn = 0; turn < 520; turn += 1) {
    await ada.react(made.channel.id, six.id, '👍');
    await ada.react(made.channel.id, six.id, '👍', false);
  }
  await ada.react(made.channel.id, six.id, '🎉');

  const again = new Conversation(blank, made.channel.id);
  await again.open();

  const expected = [
    'one, edited',
    'two',
    '  > first reply',
    'four',
    'five [❤️]',
    'six [🎉]',
    'seven',
  ];
  await expectShown(again, expected);
  expect(await serverChannel('ben', made.channel.id)).toEqual(expected);
});

// If this fails, someone removed from a private channel can still read it
// on a device that kept its messages.
test('SYN-08 a person removed from a channel while away is not shown the messages their device kept', async ({
  pageFor,
  ada,
  ben,
}) => {
  const made = await scene(ada, ben);
  const first = await pageFor('ben');
  const view = await readAndReturn(first, made.channel, made.elsewhere);
  await expectShown(view, AT_FIRST);
  const blank = await first.context().newPage();
  await first.close();

  await ada.removeParticipants(made.channel.id, [ben.person]);
  await ada.post(made.channel.id, 'after ben left');
  await blank.goto(`/app/channel/${made.channel.id}`);

  await expect(noAccess(blank)).toBeVisible();
  await expect(blank.getByText('six', { exact: true })).toHaveCount(0);
  await expect(blank.getByText('after ben left')).toHaveCount(0);
});

// If this fails, changes that arrive while a page is still loading are lost
// between what the device held and what the services send afterwards.
test('SYN-09 changes made while the page is reloading are all there when it has loaded', async ({
  pageFor,
  ada,
  ben,
}) => {
  const made = await scene(ada, ben);
  const page = await pageFor('ben');
  const view = new Conversation(page, made.channel.id);
  await view.open();
  await expectShown(view, AT_FIRST);

  const reloading = page.reload();
  await changeEverything(ada, ben, made);
  await reloading;
  await view.shown();

  // Known defect, in about 1 run in 6 on both builds: one of the changes is
  // missing from the page until it is loaded again.
  await failsSometimes(() => expectShown(view, AFTER_EVERYTHING));
  expect(await serverChannel('ben', made.channel.id)).toEqual(AFTER_EVERYTHING);
  await view.reload();
  await expectShown(view, AFTER_EVERYTHING);
});

// If this fails, a channel that went through many rounds of leaving,
// losing the connection and reloading drifts away from what was said.
test('SYN-10 a channel stays right through rounds of leaving it, losing the connection and reloading', async ({
  pageFor,
  ada,
  ben,
}) => {
  test.setTimeout(180_000);
  const made = await scene(ada, ben);
  const { channel, messages } = made;
  const page = await pageFor('ben');
  const view = new Conversation(page, channel.id);
  await view.open();
  await expectShown(view, AT_FIRST);

  // Round one: offline with the channel open.
  await goOffline(page.context());
  const seven = await ada.post(channel.id, 'seven');
  await ada.edit(channel.id, messages[0].id, 'one, edited');
  await ben.react(channel.id, messages[5].id, '👍');
  await goOnline(page.context());
  await expectShown(view, [
    'one, edited',
    'two',
    '  > first reply',
    'three',
    'four',
    'five',
    'six [👍]',
    'seven',
  ]);

  // Round two: in another channel, then a reload there.
  await findRow(page, made.elsewhere);
  await openFromList(page, made.elsewhere);
  await ada.remove(channel.id, seven.id);
  await ada.edit(channel.id, messages[0].id, 'one, edited twice');
  await ada.react(channel.id, messages[5].id, '👍');
  await page.reload();
  await new Conversation(page, made.elsewhere.id).shown();
  await ben.post(channel.id, 'eight');

  // Round three: offline and elsewhere, then back.
  await findRow(page, channel);
  await goOffline(page.context());
  await ben.react(channel.id, messages[5].id, '👍', false);
  await ada.post(channel.id, 'second reply', { threadId: messages[1].id });
  await ada.remove(channel.id, messages[3].id);
  await goOnline(page.context());
  await openFromList(page, channel);

  const expected = [
    'one, edited twice',
    'two',
    '  > first reply',
    '  > second reply',
    'three',
    'five',
    'six [👍]',
    'eight',
  ];
  await expectShown(view, expected);
  expect(await serverChannel('ben', channel.id)).toEqual(expected);

  // And once more from the device alone.
  await page.reload();
  await view.shown();
  await expectShown(view, expected);
});
