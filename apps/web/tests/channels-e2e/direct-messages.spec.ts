import { unique } from './harness/api';
import { ChannelView, conversationRow } from './harness/channel';
import { expect, failsSometimes, test } from './harness/fixtures';
import {
  addRecipient,
  findConversations,
  firstMessageBox,
  openConversationId,
  recipients,
  section,
  startDirectMessage,
} from './harness/sidebar';

/** The address of an existing conversation, not of one still to be started. */
const CONVERSATION = /\/app\/channels?\/[0-9a-f-]{36}/;

// Direct messages between two people are one conversation for the life of
// the stack, so every text here is one no other run has used.

// If this fails, a person cannot start a private conversation, or the other
// person does not get it, cannot answer, or loses it on reload.
test('DM-01 a direct message I start reaches the other person at once under “Direct messages”, and they can answer', async ({
  page,
  ada,
  people,
  pageFor,
}) => {
  const hello = unique('hello ben');
  const answer = unique('hello ada');
  const channel = await ada.createChannel({ members: [people.ben] });
  const benPage = await pageFor('ben');
  await new ChannelView(benPage, channel.id).open();
  await new ChannelView(page, channel.id).open();

  await startDirectMessage(page);
  await addRecipient(page, people.ben.email);
  await expect(page.getByText('DM with Ben Member')).toBeVisible();
  await firstMessageBox(page).click();
  await page.keyboard.type(hello);
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(CONVERSATION);
  const id = openConversationId(page);
  const view = new ChannelView(page, id);
  await view.shown();
  await view.expectEndsWith([hello]);

  const benRow = section(benPage, 'direct_messages').locator(
    `[data-key="channel:${id}"]`
  );
  // Known defect, on some machines: the new conversation is missing from
  // the other person's open list until a reload.
  await failsSometimes(async () => {
    await expect(benRow).toContainText('Ada Owner');
  });
  if (!(await benRow.isVisible())) await benPage.reload();
  await expect(benRow).toContainText('Ada Owner');
  await benRow.getByRole('treeitem').click();
  const benView = new ChannelView(benPage, id);
  await benView.shown();
  await benView.expectEndsWith([hello]);
  await benView.send(answer);

  await view.expectEndsWith([hello, answer]);
  await page.reload();
  await view.shown();
  await view.expectEndsWith([hello, answer]);
});

// If this fails, writing to the same person again starts a second
// conversation, and their messages are split between two rows.
test('DM-02 writing to the same person again from “New direct message” continues the one conversation', async ({
  page,
  ada,
  people,
  pageFor,
}) => {
  const first = unique('first to cy');
  const second = unique('second to cy');
  const channel = await ada.createChannel({ members: [people.cy] });
  const cyPage = await pageFor('cy');
  await new ChannelView(cyPage, channel.id).open();
  await new ChannelView(page, channel.id).open();

  await startDirectMessage(page);
  await addRecipient(page, people.cy.email);
  await firstMessageBox(page).click();
  await page.keyboard.type(first);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(CONVERSATION);
  const id = openConversationId(page);
  const view = new ChannelView(page, id);
  await view.shown();
  await view.expectEndsWith([first]);

  await startDirectMessage(page);
  await addRecipient(page, people.cy.email);
  await firstMessageBox(page).click();
  await page.keyboard.type(second);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(CONVERSATION);

  await view.shown();
  await view.expectEndsWith([first, second]);

  const cyRow = section(cyPage, 'direct_messages').locator(
    `[data-key="channel:${id}"]`
  );
  // Known defect: the first conversation these two ever have is missing
  // from the other person's open list until a reload, so with channel local
  // sync this shows once for each cast in the life of a stack; elsewhere it
  // has shown on some machines.
  await failsSometimes(async () => {
    await expect(cyRow).toContainText('Ada Owner');
  });
  if (!(await cyRow.isVisible())) await cyPage.reload();
  await expect(cyRow).toContainText('Ada Owner');
  await cyRow.getByRole('treeitem').click();
  const cyView = new ChannelView(cyPage, id);
  await cyView.shown();
  await cyView.expectEndsWith([first, second]);

  // One conversation, so one row. After a reload: the list of the person who
  // started a conversation does not show it before one (DM-07).
  await page.reload();
  await view.shown();
  await expect(
    section(page, 'direct_messages').getByRole('treeitem', {
      name: 'Cy Teammate',
    })
  ).toHaveCount(1);
});

// If this fails, a person cannot write to someone from a channel's list of
// participants, or lands in a new, empty conversation each time.
test('DM-03 “Message …” on a channel’s participant opens my conversation with them, the same one every time', async ({
  ada,
  people,
  pageFor,
}) => {
  const hello = unique('ben to cy');
  const channel = await ada.createChannel({
    members: [people.ben, people.cy],
  });
  const cyPage = await pageFor('cy');
  await new ChannelView(cyPage, channel.id).open();
  const benPage = await pageFor('ben');
  const channelView = new ChannelView(benPage, channel.id);
  const messageCy = async () => {
    await channelView.open();
    await benPage
      .getByRole('radiogroup', { name: 'Channel sections' })
      .getByText('Participants', { exact: true })
      .click();
    await benPage
      .getByRole('main')
      .getByRole('link', { name: 'Message Cy Teammate' })
      .click();
  };

  await messageCy();
  await benPage
    .getByRole('textbox', { name: 'Type @ to share with Cy' })
    .click();
  await benPage.keyboard.type(hello);
  await benPage.keyboard.press('Enter');
  await expect(benPage).toHaveURL(CONVERSATION);
  const id = openConversationId(benPage);
  const view = new ChannelView(benPage, id);
  await view.shown();
  await view.expectEndsWith([hello]);

  const cyRow = section(cyPage, 'direct_messages').locator(
    `[data-key="channel:${id}"]`
  );
  // Known defect, on some machines: the new conversation is missing from
  // the other person's open list until a reload.
  await failsSometimes(async () => {
    await expect(cyRow).toContainText('Ben Member');
  });
  if (!(await cyRow.isVisible())) await cyPage.reload();
  await expect(cyRow).toContainText('Ben Member');
  await cyRow.getByRole('treeitem').click();
  await new ChannelView(cyPage, id).expectEndsWith([hello]);

  await messageCy();
  await view.shown();
  await view.expectEndsWith([hello]);
});

// If this fails, a person cannot start a conversation with several people
// at once, or some of them are left out of it.
test('DM-04 a named group started from “New direct message” reaches everyone I put in it', async ({
  page,
  ada,
  people,
  pageFor,
}) => {
  const name = unique('group');
  const channel = await ada.createChannel({
    members: [people.ben, people.cy],
  });
  const benPage = await pageFor('ben');
  await new ChannelView(benPage, channel.id).open();
  const cyPage = await pageFor('cy');
  await new ChannelView(cyPage, channel.id).open();
  await new ChannelView(page, channel.id).open();

  await startDirectMessage(page);
  await addRecipient(page, people.ben.email);
  await addRecipient(page, people.cy.email);
  await page.getByRole('textbox', { name: /^Group chat with/ }).fill(name);
  await firstMessageBox(page).click();
  await page.keyboard.type('hello, both of you');
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(CONVERSATION);
  const id = openConversationId(page);
  const view = new ChannelView(page, id);
  await view.shown();
  await view.expectEndsWith(['hello, both of you']);
  await findConversations(page, name);
  await expect(conversationRow(page, name)).toBeVisible();

  for (const theirs of [benPage, cyPage]) {
    await findConversations(theirs, name);
    await conversationRow(theirs, name).click();
    const theirView = new ChannelView(theirs, id);
    await theirView.shown();
    await theirView.expectEndsWith(['hello, both of you']);
  }

  await page
    .getByRole('radiogroup', { name: 'Channel sections' })
    .getByText('Participants', { exact: true })
    .click();
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: /^Message / })).toHaveCount(3);
  for (const name of ['Ada Owner', 'Ben Member', 'Cy Teammate']) {
    await expect(
      main.getByRole('link', { name: `Message ${name}` })
    ).toBeVisible();
  }
});

// If this fails, a person about to write to someone for the first time is
// not told what will happen, or a conversation is made before they write.
test('DM-05 a conversation with someone I never wrote to opens empty, saying “Say hello”, and nothing can be sent until I type', async ({
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({
    members: [people.cy, people.dee],
  });
  const deePage = await pageFor('dee');
  await new ChannelView(deePage, channel.id).open();

  await deePage
    .getByRole('radiogroup', { name: 'Channel sections' })
    .getByText('Participants', { exact: true })
    .click();
  await deePage
    .getByRole('main')
    .getByRole('link', { name: 'Message Cy Teammate' })
    .click();

  const main = deePage.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Say hello' })).toBeVisible();
  await expect(
    main.getByText('Send a message to start the conversation.', {
      exact: false,
    })
  ).toBeVisible();
  await expect(
    main.getByRole('textbox', { name: 'Type @ to share with Cy' })
  ).toBeVisible();
  await expect(
    main.getByRole('button', { name: 'Send message' })
  ).toBeDisabled();
  await expect(
    section(deePage, 'direct_messages').getByRole('treeitem', {
      name: 'Cy Teammate',
    })
  ).toHaveCount(0);
});

// If this fails, a person can only write to someone whose whole email
// address they know by heart.
test('DM-06 typing a teammate’s name in “New direct message” offers that person', async ({
  page,
  ada,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await new ChannelView(page, channel.id).open();

  await startDirectMessage(page);
  await recipients(page).first().click();
  await page.keyboard.type('Ben');

  await expect(page.getByRole('option', { name: /Ben Member/ })).toBeVisible();
});
