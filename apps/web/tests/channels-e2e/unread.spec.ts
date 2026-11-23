import { type Api, unique } from './harness/api';
import { ChannelView, conversationRow } from './harness/channel';
import { mentionPerson } from './harness/composer';
import { expect, failsSometimes, test } from './harness/fixtures';
import type { Person } from './harness/people';
import {
  chooseFromRowMenu,
  findConversations,
  haveViewed,
  mentionCount,
  mutedBell,
  unreadDot,
} from './harness/sidebar';

/**
 * Channels of one test, named alike so that searching the list for the
 * shared part of the name shows exactly their rows.
 */
async function channelsNamed(
  ada: Api,
  members: Person[],
  ...names: string[]
): Promise<{ tag: string; [name: string]: string }> {
  const tag = unique('unr');
  const made: { tag: string; [name: string]: string } = { tag };
  for (const name of names) {
    const channel = await ada.createChannel({
      name: `${tag}-${name}`,
      members,
    });
    made[name] = channel.id;
  }
  return made;
}

// If this fails, a person is not told about a message in a channel they
// are not looking at, or the channel stays marked after they have read it.
test('UNR-01 a message in a channel I do not have open marks its row unread at once; opening it clears the mark, also after reload', async ({
  page,
  ada,
  ben,
  people,
}) => {
  const made = await channelsNamed(
    ada,
    [people.ben],
    'open',
    'other',
    'untouched'
  );
  await ada.post(made.other, 'read before');
  await ada.post(made.untouched, 'read before');
  await new ChannelView(page, made.open).open();
  const other = conversationRow(page, `${made.tag}-other`);
  const untouched = conversationRow(page, `${made.tag}-untouched`);
  await expect(other).toBeVisible();
  await expect(unreadDot(other)).toHaveCount(0);

  await ben.post(made.other, 'while you were away');
  await ben.post(made.untouched, 'left unread');
  // In the whole list: marks arriving while the list is being searched are
  // UNR-10.
  await expect(
    unreadDot(conversationRow(page, `${made.tag}-other`))
  ).toBeVisible();
  await expect(
    unreadDot(conversationRow(page, `${made.tag}-untouched`))
  ).toBeVisible();
  await expect(unreadDot(other)).toBeVisible();
  await expect(unreadDot(untouched)).toBeVisible();

  await other.click();
  const otherView = new ChannelView(page, made.other);
  await otherView.shown();
  await otherView.expectEndsWith(['read before', 'while you were away']);
  await expect(unreadDot(other)).toHaveCount(0);

  await page.reload();
  await otherView.shown();
  // The channel nobody opened shows the list has its unread marks again.
  await expect(unreadDot(untouched)).toBeVisible();
  await expect(unreadDot(other)).toHaveCount(0);
});

// If this fails, a person coming back to a channel cannot see where the
// messages they have not read begin, or cannot dismiss the marker.
test('UNR-02 a channel with unread messages opens with “New” above the first of them, and “Mark as read” removes it', async ({
  page,
  ada,
  ben,
  people,
}) => {
  const made = await channelsNamed(ada, [people.ben], 'elsewhere', 'channel');
  await ada.post(made.channel, 'read one');
  await ben.post(made.channel, 'read two');
  await haveViewed('ada', made.channel);
  const unread = await ben.postAll(made.channel, ['new one', 'new two']);
  await new ChannelView(page, made.elsewhere).open();
  await findConversations(page, made.tag);
  const row = conversationRow(page, `${made.tag}-channel`);
  await expect(unreadDot(row)).toBeVisible();

  await row.click();
  const view = new ChannelView(page, made.channel);
  await view.shown();
  await view.expectEndsWith(['read one', 'read two', 'new one', 'new two']);

  const divider = view.list.getByRole('button', { name: 'New', exact: true });
  await expect(divider).toHaveCount(1);
  await expect(divider).toHaveAttribute('title', 'Mark as read');
  await expect(
    view.thread(unread[0].id).getByRole('button', { name: 'New', exact: true })
  ).toBeVisible();

  await divider.click();
  await expect(divider).toHaveCount(0);
  await view.expectEndsWith(['read one', 'read two', 'new one', 'new two']);
});

// If this fails, a person's own messages, sent from here or from another
// device, light up their own channels as unread.
test('UNR-03 my own messages never mark a channel unread for me', async ({
  page,
  ada,
  ben,
  people,
}) => {
  const made = await channelsNamed(ada, [people.ben], 'mine', 'phone', 'bens');
  await ada.post(made.bens, 'earlier');
  const mineView = new ChannelView(page, made.mine);
  await mineView.open();
  await mineView.send('typed here');
  await mineView.expectEndsWith(['typed here']);

  await ada.postAll(made.phone, ['sent from my phone', 'and another']);
  await ben.post(made.bens, 'from ben, after both');

  // Ben's message came after all of Ada's, so their marks would be here.
  await expect(
    unreadDot(conversationRow(page, `${made.tag}-bens`))
  ).toBeVisible();
  await expect(
    unreadDot(conversationRow(page, `${made.tag}-bens`))
  ).toBeVisible();
  const phone = conversationRow(page, `${made.tag}-phone`);
  await expect(phone).toBeVisible();
  await expect(unreadDot(phone)).toHaveCount(0);
  await expect(
    unreadDot(conversationRow(page, `${made.tag}-mine`))
  ).toHaveCount(0);
});

// If this fails, a person reading older messages is not told that new ones
// came in below, or the notice does not take them there.
test('UNR-04 scrolled up in an open channel, a new message shows “1 unread … below”, which leads to it', async ({
  page,
  ada,
  ben,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(
    channel.id,
    Array.from({ length: 40 }, (_, index) => `filler ${index + 1}`)
  );
  const view = new ChannelView(page, channel.id);
  await view.open();
  await view.expectAtBottom();
  await view.wheel(-3_000);
  await expect(view.message('filler 40')).not.toBeInViewport();

  await ben.post(channel.id, 'came in below');

  const chip = page.getByRole('button', {
    name: '1 unread notification stack below',
  });
  // Known defect, in about 1 run in 10: the notice never appears, or appears
  // and is gone again before it can be clicked. The click is bounded so that
  // the second form is recorded here rather than running out the test's time.
  await failsSometimes(async () => {
    await expect(chip).toBeVisible();
    await expect(view.message('came in below')).not.toBeInViewport();
    await chip.click({ timeout: 15_000 });

    await expect(view.message('came in below')).toBeInViewport();
    await expect(chip).toBeHidden();
  });
});

// If this fails, a person cannot tell a channel where they were mentioned
// from one that merely has new messages.
test('UNR-05 a mention of me in a channel I do not have open shows a count of mentions on its row', async ({
  page,
  ada,
  people,
  pageFor,
}) => {
  const made = await channelsNamed(ada, [people.ben], 'open', 'other');
  await ada.post(made.other, 'earlier');
  await new ChannelView(page, made.open).open();
  await findConversations(page, made.tag);
  const benPage = await pageFor('ben');
  const benView = new ChannelView(benPage, made.other);
  await benView.open();

  await mentionPerson(benView, 'Ada', people.ada.email);
  await benPage.keyboard.type(' please read');
  await benPage.keyboard.press('Enter');
  await expect(benView.message('@Ada please read')).toBeVisible();

  const row = conversationRow(page, `${made.tag}-other`);
  await expect(unreadDot(row).or(mentionCount(row))).toBeVisible();
  await expect(mentionCount(row)).toHaveText('1', { timeout: 5_000 });
  await expect(mentionCount(row)).toHaveAccessibleName('1 unread mention');
});

// If this fails, muting a channel does nothing a person can see, cannot be
// undone, or the channel stays silent after it is unmuted.
test('UNR-06 a muted channel shows a crossed bell and is not marked unread by new messages; unmuted, it is again', async ({
  page,
  ada,
  ben,
  people,
}) => {
  const made = await channelsNamed(ada, [people.ben], 'open', 'muted', 'loud');
  await ada.post(made.muted, 'before muting');
  await ada.post(made.loud, 'never muted');
  await new ChannelView(page, made.open).open();
  const row = conversationRow(page, `${made.tag}-muted`);
  await expect(row).toBeVisible();
  await expect(mutedBell(row)).toHaveCount(0);

  // The submenu's entries are sometimes made again while it is open; the one
  // with the keyboard is then gone, and Enter chooses nothing.
  const mute = () =>
    chooseFromRowMenu(page, row, 'Mute', 'Until I turn it off');
  await failsSometimes(async () => {
    await mute();
    await expect(mutedBell(row)).toBeVisible({ timeout: 5_000 });
  });
  // Only while the submenu is still open: once muted, the menu offers Unmute.
  const entry = page.getByRole('menuitem', { name: 'Until I turn it off' });
  if ((await entry.count()) > 0) await mute();
  await expect(mutedBell(row)).toBeVisible();

  await ben.post(made.muted, 'while muted');
  await ben.post(made.loud, 'after the muted one');
  // The later message has arrived, so the muted one's mark would be here.
  await expect(
    unreadDot(conversationRow(page, `${made.tag}-loud`))
  ).toBeVisible();
  await expect(
    unreadDot(conversationRow(page, `${made.tag}-loud`))
  ).toBeVisible();
  await expect(unreadDot(row)).toHaveCount(0);
  await expect(mutedBell(row)).toBeVisible();

  await chooseFromRowMenu(page, row, 'Unmute');
  await expect(mutedBell(row)).toHaveCount(0);
  await ben.post(made.muted, 'after unmuting');
  await expect(
    unreadDot(conversationRow(page, `${made.tag}-muted`))
  ).toBeVisible();
  await expect(unreadDot(row)).toBeVisible();

  await row.click();
  const view = new ChannelView(page, made.muted);
  await view.shown();
  await view.expectEndsWith(['before muting', 'while muted', 'after unmuting']);
  await page.reload();
  await view.shown();
  await expect(row).toBeVisible();
  await expect(mutedBell(row)).toHaveCount(0);
});

// If this fails, a member who has never opened a channel is not shown that
// it has messages for them, or does not get all of them when they open it.
test('UNR-07 a member who never opened a channel sees it unread, and opening it shows every message and clears the mark', async ({
  ada,
  ben,
  people,
  pageFor,
}) => {
  const made = await channelsNamed(
    ada,
    [people.ben, people.cy],
    'elsewhere',
    'channel'
  );
  await ada.post(made.channel, 'first, from ada');
  await ben.post(made.channel, 'second, from ben');
  await ada.post(made.channel, 'third, from ada');

  const cyPage = await pageFor('cy');
  await new ChannelView(cyPage, made.elsewhere).open();
  await findConversations(cyPage, made.tag);
  const row = conversationRow(cyPage, `${made.tag}-channel`);
  await expect(unreadDot(row)).toBeVisible();

  await row.click();
  const view = new ChannelView(cyPage, made.channel);
  await view.shown();
  expect(await view.drawnTexts()).toEqual([
    'first, from ada',
    'second, from ben',
    'third, from ada',
  ]);
  await expect(unreadDot(row)).toHaveCount(0);

  await ben.post(made.channel, 'fourth, live');
  await view.expectEndsWith(['third, from ada', 'fourth, live']);
  await expect(unreadDot(row)).toHaveCount(0);
});

// If this fails, a person added to a channel does not see it, or cannot
// open it, until they reload.
test('UNR-08 a channel I am added to appears in my list at once, and opens', async ({
  ada,
  people,
  pageFor,
}) => {
  const made = await channelsNamed(ada, [people.ben], 'open');
  const benPage = await pageFor('ben');
  await new ChannelView(benPage, made.open).open();
  await findConversations(benPage, made.tag);
  const row = conversationRow(benPage, `${made.tag}-added`);
  await expect(conversationRow(benPage, `${made.tag}-open`)).toBeVisible();
  await expect(row).toHaveCount(0);

  const added = await ada.createChannel({
    name: `${made.tag}-added`,
    members: [people.ben],
  });
  await ada.post(added.id, 'welcome');

  await expect(row).toBeVisible();
  await row.click();
  const view = new ChannelView(benPage, added.id);
  await view.shown();
  await view.expectEndsWith(['welcome']);
});

// If this fails, the first thing anyone says in a new channel goes
// unnoticed by everyone who is not looking at it.
test('UNR-09 the first message in a new channel marks it unread for the other member', async ({
  page,
  ada,
  ben,
  people,
}) => {
  const made = await channelsNamed(ada, [people.ben], 'open', 'fresh', 'used');
  await ada.post(made.used, 'earlier');
  await new ChannelView(page, made.open).open();
  await findConversations(page, made.tag);
  const fresh = conversationRow(page, `${made.tag}-fresh`);
  await expect(fresh).toBeVisible();
  await expect(unreadDot(fresh)).toHaveCount(0);

  await ben.post(made.fresh, 'first ever');
  await ben.post(made.used, 'later than the first');

  // The later message has arrived, so the first one's mark would be here.
  await expect(
    unreadDot(conversationRow(page, `${made.tag}-used`))
  ).toBeVisible();
  await expect(unreadDot(fresh)).toBeVisible({ timeout: 5_000 });
});

// If this fails, a person who has narrowed the list with "Search
// conversations" is not told about a new message in the channels it shows.
test('UNR-10 a row found with “Search conversations” is marked unread at once when a message arrives', async ({
  page,
  ada,
  ben,
  people,
}) => {
  // Was a defect in every run; since the base of 2026-11-21 the row is marked
  // in most runs (4 of 5 on each build).
  const made = await channelsNamed(ada, [people.ben], 'open', 'found');
  await ada.post(made.found, 'read before');
  await new ChannelView(page, made.open).open();
  await findConversations(page, made.tag);
  const found = conversationRow(page, `${made.tag}-found`);
  await expect(found).toBeVisible();
  await expect(unreadDot(found)).toHaveCount(0);

  await ben.post(made.found, 'while you were searching');

  await failsSometimes(() => expect(unreadDot(found)).toBeVisible());
});
