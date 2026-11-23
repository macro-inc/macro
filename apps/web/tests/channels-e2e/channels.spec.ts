import { unique } from './harness/api';
import { ChannelView, conversations } from './harness/channel';
import { expect, failsSometimes, knownDefect, test } from './harness/fixtures';
import {
  channelAction,
  channelHeader,
  chooseChannelAction,
  createChannelInApp,
  deleteChannel,
  expectTimelineEndsWith,
  favoriteRow,
  filterConversations,
  findConversation,
  participant,
  showTab,
  sidebarRow,
  sidebarSectionOf,
  systemLine,
} from './harness/management';

// If this fails, a person cannot start a private channel: it does not open,
// is missing from their list, or will not take its first message.
test('CHN-01 a private channel made in the app opens empty, shows in the list and takes its first message', async ({
  page,
}) => {
  const name = unique('private');
  await page.goto('/app/channels');
  const id = await createChannelInApp(page, name, 'Private');

  const view = new ChannelView(page, id);
  await view.shown();
  await expect(channelHeader(page)).toContainText(name);
  await expect(view.list.locator('[data-message]')).toHaveCount(0);

  await view.send('the first message');

  await view.expectEndsWith(['the first message']);
  await page.reload();
  await view.shown();
  await view.expectEndsWith(['the first message']);

  // The list of conversations draws only its first rows, so a person with
  // many channels finds the new one by its name.
  await page.goto('/app/channels');
  await filterConversations(page, name);
  await conversations(page).getByRole('treeitem', { name }).click();
  await view.shown();
  await view.expectEndsWith(['the first message']);
});

// If this fails, a channel made for the team never reaches the teammates it
// was made for, or they cannot read it.
test('CHN-02 a team channel made in the app appears for a teammate under the team’s channels and can be read', async ({
  page,
  ada,
  people,
  pageFor,
}) => {
  const name = unique('team');
  const benPage = await pageFor('ben');
  // Ben is in the app and hearing what happens before the channel is made:
  // a page that has only just loaded can miss what happens as it connects.
  const other = await ada.createChannel({ members: [people.ben] });
  const benOther = new ChannelView(benPage, other.id);
  await benOther.open();
  await ada.post(other.id, 'ben is listening');
  await benOther.expectEndsWith(['ben is listening']);

  await page.goto('/app/channels');
  const id = await createChannelInApp(page, name, 'Team');

  try {
    const view = new ChannelView(page, id);
    await view.shown();
    await view.send('hello team');
    await view.expectEndsWith(['hello team']);

    // Ben was looking for the channel before it existed; it turns up
    // without a reload.
    const found = benPage
      .getByRole('tree', { name: 'Conversations' })
      .getByRole('treeitem', { name });
    const benView = new ChannelView(benPage, id);
    const readByBen = async () => {
      await expect(found).toBeVisible();
      await found.click();
      await benView.shown();
      await benView.expectEndsWith(['hello team']);
      await expect(channelHeader(benPage)).toContainText(name);
      await expect(sidebarRow(benPage, id)).toContainText(name);
      await expect
        .poll(() => sidebarSectionOf(benPage, id), {
          message: 'the heading the channel sits under for Ben',
        })
        .toBe('team_channels');
    };
    // Known defect on main, on some machines in every run and on others in
    // none: Ben's list is read again before the new channel is in it, so the
    // row is missing, or goes when the channel is opened, until a reload.
    await failsSometimes(readByBen);

    await benPage.goto('/app/channels');
    await readByBen();
  } finally {
    // Team channels show for everyone on the team, in every other test.
    await deleteChannel('ada', id);
  }
});

// If this fails, renaming a channel does not take, or the people in it are
// never told it was renamed.
test('CHN-03 renaming a channel updates its header and list row, and tells both members in the channel', async ({
  page,
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['before the rename']);
  const renamed = unique('renamed');

  const view = new ChannelView(page, channel.id);
  await view.open();
  const benPage = await pageFor('ben');
  const benView = new ChannelView(benPage, channel.id);
  await benView.open();

  await chooseChannelAction(page, 'Rename');
  const dialog = page.getByRole('dialog', { name: 'Rename item' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill(renamed);
  await dialog.getByRole('button', { name: 'Save name' }).click();

  await expect(channelHeader(page)).toContainText(renamed);
  await expectTimelineEndsWith(view, [
    'before the rename',
    `Ada Owner renamed the channel to ${renamed}`,
  ]);

  // Ben has the channel open and sees the same, without a reload.
  await expectTimelineEndsWith(benView, [
    'before the rename',
    `Ada Owner renamed the channel to ${renamed}`,
  ]);
  await findConversation(benPage, renamed);
  await findConversation(page, renamed);
});

// If this fails, a person who has a channel open while someone renames it
// goes on seeing the old name above the messages.
test('CHN-04 a rename shows in the header of a member who has the channel open', async ({
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['before the rename']);
  const renamed = unique('renamed');

  const benPage = await pageFor('ben');
  const benView = new ChannelView(benPage, channel.id);
  await benView.open();
  await expect(channelHeader(benPage)).toContainText(channel.name);

  const adaPage = await pageFor('ada');
  await new ChannelView(adaPage, channel.id).open();
  await chooseChannelAction(adaPage, 'Rename');
  const dialog = adaPage.getByRole('dialog', { name: 'Rename item' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill(renamed);
  await dialog.getByRole('button', { name: 'Save name' }).click();

  await expect(
    systemLine(benPage, `renamed the channel to ${renamed}`)
  ).toBeVisible();
  await expect(channelHeader(benPage)).toContainText(renamed);
});

// If this fails, a favorite does not stick: the channel never shows under
// Favorites, will not leave it, or is forgotten on reload.
test('CHN-05 a channel can be made a favorite and taken out again, and both survive a reload', async ({
  page,
  ada,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['a message']);
  const view = new ChannelView(page, channel.id);
  await view.open();
  await expect(favoriteRow(page, channel.id)).toHaveCount(0);

  await chooseChannelAction(page, 'Favorite');

  await expect(favoriteRow(page, channel.id)).toHaveText(channel.name);
  await page.reload();
  await view.shown();
  await expect(favoriteRow(page, channel.id)).toHaveText(channel.name);

  await chooseChannelAction(page, 'Unfavorite');

  await expect(favoriteRow(page, channel.id)).toHaveCount(0);
  await page.reload();
  await view.shown();
  await page.getByRole('button', { name: 'Channel actions' }).click();
  await expect(channelAction(page, 'Favorite')).toBeVisible();
  await expect(favoriteRow(page, channel.id)).toHaveCount(0);
});

// If this fails, a link copied from a channel leads somewhere else, or
// nowhere, when a member opens it.
test('CHN-06 Copy Link gives an address that opens the channel for another member', async ({
  page,
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['linked one', 'linked two']);
  await new ChannelView(page, channel.id).open();

  await chooseChannelAction(page, 'Copy Link');
  const copied = () => page.evaluate(() => navigator.clipboard.readText());
  await expect.poll(copied).toContain(channel.id);
  const link = await copied();

  const benPage = await pageFor('ben');
  await benPage.goto(link);
  const benView = new ChannelView(benPage, channel.id);
  await benView.shown();
  await expect(channelHeader(benPage)).toContainText(channel.name);
  await benView.expectEndsWith(['linked one', 'linked two']);
});

// If this fails, a deleted channel lingers in its owner's list or on their
// screen, or can still be opened from its address.
test('CHN-07 deleting a channel removes it for its owner at once, and its address no longer opens for anyone', async ({
  page,
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['soon gone one', 'soon gone two']);

  const view = new ChannelView(page, channel.id);
  await view.open();
  await expect(sidebarRow(page, channel.id)).toContainText(channel.name);

  const benPage = await pageFor('ben');
  const benView = new ChannelView(benPage, channel.id);
  await benView.open();
  await benView.expectEndsWith(['soon gone one', 'soon gone two']);

  await chooseChannelAction(page, 'Delete');
  const dialog = page.getByRole('dialog', { name: 'Delete item?' });
  await expect(dialog).toContainText(channel.name);
  await dialog.getByRole('button', { name: 'Delete item' }).click();

  // The owner: the channel is gone from the list and from the screen.
  await expect(sidebarRow(page, channel.id)).toHaveCount(0);
  await expect(view.composer).toHaveCount(0);
  await expect(page.getByText('soon gone two')).toHaveCount(0);

  // Its address no longer opens it, for either; the member's list drops it.
  await benPage.reload();
  await expect(
    benPage.getByRole('heading', { name: 'Conversation unavailable' })
  ).toBeVisible();
  await expect(benPage.getByText('soon gone two')).toHaveCount(0);
  // Known defect on main, seen once in 62 runs: after the reload the
  // deleted channel is still in the member's list.
  await failsSometimes(async () => {
    await expect(sidebarRow(benPage, channel.id)).toHaveCount(0);
  });
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Conversation unavailable' })
  ).toBeVisible();
});

// If this fails, deleting a favorite channel leaves a dead row under
// Favorites that opens nothing.
test('CHN-08 a deleted channel leaves its owner’s Favorites too', async ({
  page,
  ada,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['a message']);
  await new ChannelView(page, channel.id).open();
  await chooseChannelAction(page, 'Favorite');
  await expect(favoriteRow(page, channel.id)).toHaveText(channel.name);

  const confirm = page.getByRole('dialog', { name: 'Delete item?' });
  await page.getByRole('button', { name: 'Channel actions' }).click();
  await channelAction(page, 'Delete').click();
  await confirm.getByRole('button', { name: 'Delete item' }).click();

  await expect(sidebarRow(page, channel.id)).toHaveCount(0);
  await expect(favoriteRow(page, channel.id)).toHaveCount(0);
});

// If this fails, any member can delete a channel that is not theirs.
test('CHN-09 a member who does not own the channel is not offered Delete', async ({
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['a message']);

  const benPage = await pageFor('ben');
  await new ChannelView(benPage, channel.id).open();
  await benPage.getByRole('button', { name: 'Channel actions' }).click();

  await expect(channelAction(benPage, 'Copy Link')).toBeVisible();
  await expect(channelAction(benPage, 'Rename')).toBeVisible();
  await expect(channelAction(benPage, 'Delete')).toHaveCount(0);
});

// If this fails, a person cannot see who is in a channel.
test('CHN-10 the Participants tab lists the channel’s members by name, with the owner marked', async ({
  page,
  ada,
  people,
}) => {
  const channel = await ada.createChannel({
    members: [people.ben, people.cy],
  });
  await ada.postAll(channel.id, ['a message']);
  await new ChannelView(page, channel.id).open();

  await showTab(page, 'Participants');

  await expect(participant(page, 'Ada Owner')).toContainText('Owner');
  await expect(participant(page, 'Ben Member')).toContainText('Member');
  await expect(participant(page, 'Cy Teammate')).toContainText('Member');
  await expect(
    page.getByRole('main').getByRole('link', { name: /^Message / })
  ).toHaveCount(3);
});

// If this fails, the Attachments tab of a channel without files shows
// something other than that it has none.
test('CHN-11 the Attachments tab of a channel with no files says there are none', async ({
  page,
  ada,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['only words']);
  await new ChannelView(page, channel.id).open();

  await showTab(page, 'Attachments');

  await expect(
    page.getByText('No photos or videos in this channel yet.')
  ).toBeVisible();
  await expect(
    page.getByText('No documents in this channel yet.')
  ).toBeVisible();
  await expect(page.getByText('only words')).toHaveCount(0);
});

// If this fails, a look at another tab loses the reader's place in the
// history.
test('CHN-12 going to another tab and back keeps the message list where it was', async ({
  page,
  history,
}) => {
  const view = new ChannelView(page, history.id);
  await view.open();
  await view.expectEndsWith(['history 230']);
  await view.wheel(-1500);
  await expect
    .poll(() => view.distanceFromBottom(), {
      message: 'distance of the list from its end',
    })
    .toBeGreaterThan(1000);
  const reading = await view.topVisible();

  await showTab(page, 'Participants');
  await expect(participant(page, 'Ben Member')).toBeVisible();
  await showTab(page, 'Messages');

  await expect(view.messageById(reading.id)).toBeInViewport();
  await expect
    .poll(() => view.topVisible(), {
      message: 'the first message wholly in the window',
    })
    .toEqual(reading);
});

// If this fails, a channel's history no longer says where it starts.
test('CHN-13 a channel’s history starts with “Channel <name> created”', async ({
  page,
  ada,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['the first', 'the second']);
  const view = new ChannelView(page, channel.id);
  await view.open();
  await view.expectEndsWith(['the first', 'the second']);

  const start = view.list.getByText(`Channel ${channel.name} created`);
  await expect(start).toBeVisible();
  const startBox = await start.boundingBox();
  const firstBox = await view.message('the first').boundingBox();
  expect(startBox?.y).toBeLessThan(firstBox?.y ?? 0);
});

// If this fails, a person who has just made a channel faces a blank pane
// with nothing to say the channel exists and is empty.
test('CHN-14 a brand-new channel with no messages shows its “Channel <name> created” line', async ({
  page,
  ada,
  people,
}) => {
  // Known defect on main: the line is drawn above the oldest message, so a
  // channel with no message yet shows nothing at all above the composer.
  knownDefect();
  const channel = await ada.createChannel({ members: [people.ben] });
  const view = new ChannelView(page, channel.id);
  await view.open();

  await expect(
    page.getByRole('main').getByText(`Channel ${channel.name} created`)
  ).toBeVisible();
});

// If this fails, a person goes on looking at, and typing into, a channel
// that no longer exists.
test('CHN-15 a channel deleted elsewhere closes on its owner’s open page', async ({
  page,
  ada,
  people,
}) => {
  // Known defect on main: when nothing else reaches the person around the
  // deletion, their open page keeps the channel and its composer until a
  // reload. In about 1 run in 3.
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['soon gone']);
  const view = new ChannelView(page, channel.id);
  await view.open();
  await view.expectEndsWith(['soon gone']);

  await deleteChannel('ada', channel.id);

  await expect(view.composer).toHaveCount(0);
  await expect(page.getByText('soon gone')).toHaveCount(0);
  await page.reload();
  await expect(view.composer).toHaveCount(0);
  await expect(page.getByText('soon gone')).toHaveCount(0);
});
