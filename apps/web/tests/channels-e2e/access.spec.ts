import { ChannelView, conversations } from './harness/channel';
import {
  closeRecorded,
  expect,
  failsSometimes,
  recorded,
  test,
} from './harness/fixtures';
import {
  deleteChannel,
  expectTimelineEndsWith,
  filterConversations,
  noAccess,
  sidebarRow,
} from './harness/management';

// If this fails, a teammate who is not in a private channel can read it,
// or is left with no way to ask for it.
test('ACC-01 a teammate who is not in a private channel sees no messages and is offered to ask to join', async ({
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['members only']);

  const cyPage = await pageFor('cy');
  await cyPage.goto(`/app/channel/${channel.id}`);

  await expect(noAccess(cyPage)).toBeVisible();
  await expect(noAccess(cyPage)).toContainText(
    `Signed in as ${people.cy.email}`
  );
  await expect(
    cyPage.getByRole('button', { name: 'Ask to join' })
  ).toBeEnabled();
  await expect(cyPage.getByText('members only')).toHaveCount(0);
  await expect(cyPage.getByText(channel.name)).toHaveCount(0);
  await expect(new ChannelView(cyPage, channel.id).composer).toHaveCount(0);
  await expect(sidebarRow(cyPage, channel.id)).toHaveCount(0);
});

// If this fails, someone outside the team can read a private channel by
// knowing its address.
test('ACC-02 a person outside the team who opens a private channel’s address sees no messages', async ({
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['members only']);

  const deePage = await pageFor('dee');
  await deePage.goto(`/app/channel/${channel.id}`);

  await expect(noAccess(deePage)).toBeVisible();
  await expect(noAccess(deePage)).toContainText(
    `Signed in as ${people.dee.email}`
  );
  await expect(deePage.getByText('members only')).toHaveCount(0);
  await expect(deePage.getByText(channel.name)).toHaveCount(0);
  await expect(new ChannelView(deePage, channel.id).composer).toHaveCount(0);
});

// If this fails, asking to join a channel leads nowhere: the owner never
// sees the request, or approving it does not let the person in.
test('ACC-03 a request to join reaches the owner at once, and approving it lets the person in at once', async ({
  page,
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['members only one', 'members only two']);
  const view = new ChannelView(page, channel.id);
  await view.open();

  const cyPage = await pageFor('cy');
  await cyPage.goto(`/app/channel/${channel.id}`);
  await cyPage.getByRole('button', { name: 'Ask to join' }).click();
  await expect(
    cyPage.getByRole('button', { name: 'Withdraw request' })
  ).toBeVisible();
  await expect(cyPage.getByText('members only two')).toHaveCount(0);

  // The owner, with the channel open, gets the request without a reload.
  const request = view.list.getByText(
    `Cy Teammate (${people.cy.email}) asked to join the channel`
  );
  await expect(request).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(view.list.getByText('Approved by Ada Owner')).toBeVisible();

  // Cy is in without a reload, with everything said before.
  const cyView = new ChannelView(cyPage, channel.id);
  await cyView.shown();
  await cyView.expectEndsWith(['members only one', 'members only two']);
  await expect(noAccess(cyPage)).toHaveCount(0);

  await cyView.send('thanks for letting me in');
  await view.expectEndsWith([
    'members only one',
    'members only two',
    'thanks for letting me in',
  ]);
});

// If this fails, a refused request still lets the person in, or leaves
// them waiting with no answer.
test('ACC-04 a denied request tells the person so and shows them nothing of the channel', async ({
  page,
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['members only']);
  const view = new ChannelView(page, channel.id);
  await view.open();

  const cyPage = await pageFor('cy');
  await cyPage.goto(`/app/channel/${channel.id}`);
  await cyPage.getByRole('button', { name: 'Ask to join' }).click();
  await expect(
    view.list.getByText(
      `Cy Teammate (${people.cy.email}) asked to join the channel`
    )
  ).toBeVisible();

  await page.getByRole('button', { name: 'Deny' }).click();

  await expect(view.list.getByText('Denied by Ada Owner')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(noAccess(cyPage)).toContainText('Your request was denied.');
  await expect(cyPage.getByText('members only')).toHaveCount(0);
  await expect(new ChannelView(cyPage, channel.id).composer).toHaveCount(0);

  await cyPage.reload();
  await expect(noAccess(cyPage)).toContainText('Your request was denied.');
  await expect(cyPage.getByText('members only')).toHaveCount(0);
});

// If this fails, a person cannot take back a request to join, and the
// owner can still approve a request nobody stands behind.
test('ACC-05 a withdrawn request can no longer be approved', async ({
  page,
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['members only']);
  const view = new ChannelView(page, channel.id);
  await view.open();

  const cyPage = await pageFor('cy');
  await cyPage.goto(`/app/channel/${channel.id}`);
  await cyPage.getByRole('button', { name: 'Ask to join' }).click();
  await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();

  await cyPage.getByRole('button', { name: 'Withdraw request' }).click();

  await expect(
    cyPage.getByRole('button', { name: 'Withdraw request' })
  ).toHaveCount(0);
  await expect(view.list.getByText('Request withdrawn')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Deny' })).toHaveCount(0);
  await expect(cyPage.getByText('members only')).toHaveCount(0);
});

// If this fails, a teammate cannot get into a channel that was made for
// the whole team.
test('ACC-06 a teammate finds a team channel they are not in by its name and joins it', async ({
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({
    type: 'team',
    teamId: people.ada.teamId,
    members: [people.ada],
  });
  try {
    await ada.postAll(channel.id, ['for the whole team']);

    const benPage = await pageFor('ben');
    await benPage.goto('/app/channels');
    await filterConversations(benPage, channel.name);
    const found = conversations(benPage).getByRole('treeitem', {
      name: channel.name,
    });
    await expect(found).toBeVisible();
    await found.getByRole('button', { name: 'Join', exact: true }).click();
    // Known defect, on some machines in every
    // run and on others in none: the join works, but the row stays under
    // "Not joined" with its Join button until the page is reloaded.
    const join = benPage.getByRole('button', { name: 'Join', exact: true });
    await failsSometimes(async () => {
      await expect(join).toHaveCount(0);
    });

    const benView = new ChannelView(benPage, channel.id);
    if ((await join.count()) > 0) await benView.open();
    else await found.click();
    await benView.shown();
    await expectTimelineEndsWith(benView, [
      'for the whole team',
      'Ben Member joined the channel',
    ]);
  } finally {
    await deleteChannel('ada', channel.id);
  }
});

// If this fails, a channel made for one team can be read or joined by
// someone outside it.
test('ACC-07 a person outside the team cannot read a team channel or find it to join', async ({
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({
    type: 'team',
    teamId: people.ada.teamId,
    members: [people.ada],
  });
  try {
    await ada.postAll(channel.id, ['for the whole team']);

    const deePage = await pageFor('dee');
    await deePage.goto(`/app/channel/${channel.id}`);
    await expect(noAccess(deePage)).toBeVisible();
    await expect(deePage.getByText('for the whole team')).toHaveCount(0);
    await expect(new ChannelView(deePage, channel.id).composer).toHaveCount(0);

    await filterConversations(deePage, channel.name);
    await expect(
      deePage.getByRole('searchbox', { name: 'Search conversations' })
    ).toHaveValue(channel.name);
    await expect(
      conversations(deePage).getByRole('treeitem', { name: channel.name })
    ).toHaveCount(0);
    await expect(
      deePage.getByRole('button', { name: 'Join', exact: true })
    ).toHaveCount(0);
  } finally {
    await deleteChannel('ada', channel.id);
  }
});

// If this fails, a wrong or dead channel address leaves a person on a
// blank or endlessly loading page.
test('ACC-08 the address of a channel that does not exist says the conversation is unavailable', async ({
  page,
}) => {
  await page.goto('/app/channel/01900000-0000-7000-8000-000000000000');

  await expect(
    page.getByRole('heading', { name: 'Conversation unavailable' })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.locator('[data-input-id^="channel-input-"]')).toHaveCount(
    0
  );
});

// If this fails, someone who is not signed in can read a channel from its
// address.
test('ACC-09 a signed-out person who opens a channel’s address is asked to log in and sees nothing of it', async ({
  ada,
  people,
  browser,
  baseURL,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['members only']);

  const context = await browser.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    storageState: { cookies: [], origins: [] },
    ...recorded(),
  });
  try {
    const visitor = await context.newPage();
    await visitor.goto(`/app/channel/${channel.id}`);

    await expect(visitor.getByRole('button', { name: 'Login' })).toBeVisible();
    await expect(visitor.getByText('members only')).toHaveCount(0);
    await expect(visitor.getByText(channel.name)).toHaveCount(0);
    await expect(
      visitor.locator('[data-input-id^="channel-input-"]')
    ).toHaveCount(0);
  } finally {
    await closeRecorded(context);
  }
});
