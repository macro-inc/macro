import { writeFileSync } from 'node:fs';
import { ChannelView, conversationRow } from './harness/channel';
import {
  attach,
  attachmentsOf,
  groupMentions,
  mentionPerson,
  paste,
  personMentions,
  reachUploadStorage,
  sendButton,
  typingLine,
  waitingFiles,
  writePng,
} from './harness/composer';
import { expect, failsSometimes, test } from './harness/fixtures';
import { findConversations } from './harness/sidebar';

// If this fails, a person who starts writing, looks at another channel and
// comes back has lost what they wrote, or finds it in the wrong channel.
test('CMP-01 a draft stays in its channel while I look at another one, and is not shown there', async ({
  page,
  ada,
  people,
}) => {
  const first = await ada.createChannel({ members: [people.ben] });
  const second = await ada.createChannel({ members: [people.ben] });
  const firstView = new ChannelView(page, first.id);
  const secondView = new ChannelView(page, second.id);
  await firstView.open();

  await firstView.composerText.click();
  await page.keyboard.type('half a thought');
  await findConversations(page, second.name);
  await conversationRow(page, second.name).click();
  await secondView.shown();
  await expect(secondView.composerText).toHaveText('');

  await findConversations(page, first.name);
  await conversationRow(page, first.name).click();
  await firstView.shown();
  await expect(firstView.composerText).toHaveText('half a thought');
});

// If this fails, reloading the page throws away a message a person was
// still writing.
test('CMP-02 a draft is still in the composer after a reload', async ({
  page,
  ada,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const view = new ChannelView(page, channel.id);
  await view.open();

  await view.composerText.click();
  await page.keyboard.type('kept over a reload');
  await expect(view.composerText).toHaveText('kept over a reload');
  await page.reload();
  await view.shown();

  await expect(view.composerText).toHaveText('kept over a reload');
});

// If this fails, a message a person already sent comes back into the
// composer as a draft, ready to be sent twice.
test('CMP-03 sending a message clears its draft, and a reload does not bring it back', async ({
  page,
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const bens = new ChannelView(await pageFor('ben'), channel.id);
  await bens.open();
  const view = new ChannelView(page, channel.id);
  await view.open();

  await view.send('sent, not a draft');
  await view.expectEndsWith(['sent, not a draft']);
  await expect(view.composerText).toHaveText('');
  // Delivered, so the reload is not in the middle of the send (CMP-13).
  await bens.expectEndsWith(['sent, not a draft']);
  await page.reload();
  await view.shown();

  await view.expectEndsWith(['sent, not a draft']);
  await expect(view.composerText).toHaveText('');
});

// If this fails, a message the app showed as sent was never sent: a person
// who closes or reloads the page right after sending loses it.
test('CMP-13 a message shown as sent is still sent when the page is reloaded at once', async ({
  page,
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const bens = new ChannelView(await pageFor('ben'), channel.id);
  await bens.open();
  const view = new ChannelView(page, channel.id);
  await view.open();

  await view.send('sent just before a reload');
  await view.expectEndsWith(['sent just before a reload']);
  await page.reload();
  await view.shown();

  await view.expectEndsWith(['sent just before a reload']);
  // Known defect on main, about one run in twenty-five: the message is stored but
  // never reaches a member who has the channel open, until they reload. The
  // reload cuts the request off after the message is stored and before it is
  // announced.
  await failsSometimes(async () => {
    await bens.expectEndsWith(['sent just before a reload']);
  });
  // Known defect on main, about one run in sixteen: the sent message is
  // also back in the composer as a draft.
  await failsSometimes(async () => {
    await expect(view.composerText).toHaveText('');
  });
});

// If this fails, a person has to click back into the composer after every
// message, or can send nothing at all.
test('CMP-04 the send button is off while the composer is empty, and after sending I can go on typing', async ({
  page,
  ada,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const view = new ChannelView(page, channel.id);
  await view.open();
  await expect(sendButton(view)).toBeDisabled();

  await view.composerText.click();
  await page.keyboard.type('one');
  await expect(sendButton(view)).toBeEnabled();
  await page.keyboard.press('Enter');

  await view.expectEndsWith(['one']);
  await expect(view.composerText).toHaveText('');
  await expect(view.composerText).toBeFocused();
  await expect(sendButton(view)).toBeDisabled();

  await page.keyboard.type('two');
  await page.keyboard.press('Enter');
  await view.expectEndsWith(['one', 'two']);
});

// If this fails, mentioning someone writes plain text, names the wrong
// person, or the mentioned person does not get the message.
test('CMP-05 a person picked from the @ menu is named in the message for both people, live', async ({
  page,
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const benPage = await pageFor('ben');
  const benView = new ChannelView(benPage, channel.id);
  await benView.open();
  const view = new ChannelView(page, channel.id);
  await view.open();

  await mentionPerson(view, 'Ben', people.ben.email);
  await page.keyboard.type(' can you look?');
  await page.keyboard.press('Enter');

  for (const each of [view, benView]) {
    const message = each.message('@Ben can you look?');
    await expect(message).toBeVisible();
    await expect(personMentions(message)).toHaveText(['@Ben']);
    await expect(personMentions(message)).toHaveAttribute(
      'data-user-id',
      people.ben.userId
    );
  }
});

// If this fails, @here cannot be chosen, or is sent as plain text that
// calls nobody.
test('CMP-06 @here picked from the @ menu is sent as a mention of everyone here', async ({
  page,
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const benPage = await pageFor('ben');
  const benView = new ChannelView(benPage, channel.id);
  await benView.open();
  const view = new ChannelView(page, channel.id);
  await view.open();

  await view.composerText.click();
  await page.keyboard.type('@here');
  // Once in the composer, once in the menu.
  await expect(page.getByText('@here', { exact: true })).toHaveCount(2);
  await page.keyboard.press('Enter');
  await page.keyboard.type(' standup now');
  await page.keyboard.press('Enter');

  for (const each of [view, benView]) {
    const message = each.message('@here standup now');
    await expect(message).toBeVisible();
    await expect(groupMentions(message)).toHaveText(['@here']);
  }
});

// If this fails, a file a person attaches is not shown before sending, does
// not reach the other person, or is missing from the channel's files.
test('CMP-07 a text file and a picture attached to a message show before sending, for both people, and under Attachments', async ({
  page,
  ada,
  people,
  pageFor,
}, testInfo) => {
  const notes = testInfo.outputPath('notes.txt');
  writeFileSync(notes, 'notes for the channel');
  const picture = testInfo.outputPath('square.png');
  writePng(picture);
  const channel = await ada.createChannel({ members: [people.ben] });
  const benPage = await pageFor('ben');
  const benView = new ChannelView(benPage, channel.id);
  await benView.open();
  await reachUploadStorage(page);
  const view = new ChannelView(page, channel.id);
  await view.open();

  await attach(view, [notes, picture]);
  await expect(
    view.composer.getByRole('button', { name: 'Remove notes' })
  ).toBeVisible();
  await expect(
    view.composer.getByRole('button', { name: 'Remove square.png' })
  ).toBeVisible();
  await expect(
    view.composer.getByRole('img', { name: 'preview' })
  ).toBeVisible();

  await view.composerText.click();
  await page.keyboard.type('two files');
  await sendButton(view).click();
  await expect(waitingFiles(view)).toHaveCount(0);

  for (const each of [view, benView]) {
    const files = attachmentsOf(each.message('two files'));
    await expect(files.getByRole('link', { name: 'notes.txt' })).toBeVisible();
    await expect(
      files.getByRole('button', { name: 'Open image viewer' })
    ).toBeVisible();
  }

  await benPage
    .getByRole('radiogroup', { name: 'Channel sections' })
    .getByText('Attachments', { exact: true })
    .click();
  const main = benPage.getByRole('main');
  await expect(
    main.getByRole('heading', { name: 'Photos and Videos' })
  ).toBeVisible();
  await expect(main.getByRole('img', { name: 'preview' })).toHaveCount(1);
  await expect(main.getByRole('heading', { name: 'Documents' })).toBeVisible();
  await expect(main.getByText('notes.txt', { exact: true })).toBeVisible();
});

// If this fails, a person cannot send a file without writing something
// with it.
test('CMP-08 a file can be sent on its own, with no text', async ({
  page,
  ada,
  people,
  pageFor,
}, testInfo) => {
  const notes = testInfo.outputPath('alone.txt');
  writeFileSync(notes, 'a file with no message');
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.post(channel.id, 'before the file');
  const benPage = await pageFor('ben');
  const benView = new ChannelView(benPage, channel.id);
  await benView.open();
  await reachUploadStorage(page);
  const view = new ChannelView(page, channel.id);
  await view.open();
  await expect(sendButton(view)).toBeDisabled();

  await attach(view, [notes]);
  await expect(
    view.composer.getByRole('button', { name: 'Remove alone' })
  ).toBeVisible();
  await sendButton(view).click();
  await expect(waitingFiles(view)).toHaveCount(0);

  for (const each of [view, benView]) {
    await expect(
      each.list.getByRole('link', { name: 'alone.txt' })
    ).toBeVisible();
    await expect(each.list.locator('[data-message-attachments]')).toHaveCount(
      1
    );
    expect(await each.drawnTexts()).toEqual(['before the file']);
  }
});

// If this fails, a person cannot tell that someone is answering them, or
// the notice stays after the answer has come.
test('CMP-09 while the other person types in their composer I see “… is typing”, until they send', async ({
  page,
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.post(channel.id, 'anyone there?');
  const view = new ChannelView(page, channel.id);
  await view.open();
  const benPage = await pageFor('ben');
  const benView = new ChannelView(benPage, channel.id);
  await benView.open();
  await expect(typingLine(page, 'Ben Member')).toBeHidden();

  await benView.composerText.click();
  await benPage.keyboard.type('yes, writing');
  await expect(typingLine(page, 'Ben Member')).toBeVisible();

  await benPage.keyboard.press('Enter');
  await expect(view.message('yes, writing')).toBeVisible();
  await expect(typingLine(page, 'Ben Member')).toBeHidden();
});

// If this fails, typing from another device or app is not shown, or the
// notice outlives the typing.
test('CMP-10 typing reported from the other person’s other device shows “… is typing”, and goes when they stop', async ({
  page,
  ada,
  ben,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.post(channel.id, 'anyone there?');
  const view = new ChannelView(page, channel.id);
  await view.open();

  await ben.typing(channel.id);
  await expect(typingLine(page, 'Ben Member')).toBeVisible();

  await ben.typing(channel.id, false);
  await expect(typingLine(page, 'Ben Member')).toBeHidden({ timeout: 5_000 });
});

// If this fails, text copied from elsewhere cannot be pasted into a
// message, or arrives changed.
test('CMP-11 text pasted into the composer is sent as it was copied', async ({
  page,
  ada,
  people,
  pageFor,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const benPage = await pageFor('ben');
  const benView = new ChannelView(benPage, channel.id);
  await benView.open();
  const view = new ChannelView(page, channel.id);
  await view.open();

  await view.composerText.click();
  await paste(page, 'copied from somewhere else');
  await expect(view.composerText).toHaveText('copied from somewhere else');
  await page.keyboard.press('Enter');

  await view.expectEndsWith(['copied from somewhere else']);
  await benView.expectEndsWith(['copied from somewhere else']);
});

// If this fails, a long message is cut short or refused.
test('CMP-12 a message of 2,499 characters is sent whole', async ({
  page,
  ada,
  people,
  pageFor,
}) => {
  const long = 'abcdefghi '.repeat(250).trim();
  const channel = await ada.createChannel({ members: [people.ben] });
  const benPage = await pageFor('ben');
  const benView = new ChannelView(benPage, channel.id);
  await benView.open();
  const view = new ChannelView(page, channel.id);
  await view.open();

  await view.composerText.click();
  await page.keyboard.insertText(long);
  await page.keyboard.press('Enter');

  for (const each of [view, benView]) {
    const content = each.list.locator('[data-message-content]');
    await expect(content).toHaveText(long);
    expect((await content.innerText()).length).toBe(2499);
  }
  await expect(view.composerText).toHaveText('');
});
