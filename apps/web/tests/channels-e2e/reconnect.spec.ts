import { ChannelView } from './harness/channel';
import { expect, test } from './harness/fixtures';

// If this fails, someone whose connection dropped for a while comes back to
// a channel that is missing what was said meanwhile, until they reload.
test('REC-01 after the connection comes back, messages sent meanwhile appear in order without a reload', async ({
  page,
  context,
  ada,
  ben,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(channel.id, ['before one', 'before two']);
  const view = new ChannelView(page, channel.id);
  await view.open();
  await view.expectEndsWith(['before one', 'before two']);

  await context.setOffline(true);
  await ben.postAll(channel.id, ['while away one', 'while away two']);
  await ada.post(channel.id, 'while away three');
  await context.setOffline(false);

  await expect(view.message('while away three')).toBeVisible();
  expect(await view.drawnTexts()).toEqual([
    'before one',
    'before two',
    'while away one',
    'while away two',
    'while away three',
  ]);
});

// If this fails, a message written with no connection is lost without a
// word, or is delivered twice once the connection is back.
test('REC-02 a message sent with no connection is neither lost nor sent twice', async ({
  page,
  context,
  pageFor,
  ada,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.post(channel.id, 'before');
  const view = new ChannelView(page, channel.id);
  await view.open();
  await expect(view.message('before')).toBeVisible();

  await context.setOffline(true);
  await view.send('written offline');
  // What the app does with it now is its own business: it may keep the text
  // in the composer and say sending failed, or hold the message to send
  // later. Either way the text must still be on the screen.
  await expect(page.getByText('written offline')).toBeVisible();
  await context.setOffline(false);
  await ada.post(channel.id, 'after');
  await expect(view.message('after')).toBeVisible();

  // The text is in exactly one place: still in the composer, or in the
  // channel once.
  const inComposer = await view.composerText
    .getByText('written offline')
    .count();
  const inChannel = (await view.drawnTexts()).filter(
    (text) => text === 'written offline'
  ).length;
  expect(inComposer + inChannel).toBe(1);

  // And the other person sees exactly what the channel holds.
  const bens = await pageFor('ben');
  const bensView = new ChannelView(bens, channel.id);
  await bensView.open();
  await expect(bensView.message('after')).toBeVisible();
  expect(
    (await bensView.drawnTexts()).filter((text) => text === 'written offline')
  ).toHaveLength(inChannel);
});

// If this fails, someone who switches to another tab and back finds the
// channel without what was said while they were away.
test('REC-03 a message that arrives while the page is hidden is there when the person comes back', async ({
  page,
  context,
  ada,
  ben,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.post(channel.id, 'before');
  const view = new ChannelView(page, channel.id);
  await view.open();
  await expect(view.message('before')).toBeVisible();

  // Another tab in front hides the channel's page, as switching tabs does.
  const other = await context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  await ben.postAll(channel.id, ['while hidden one', 'while hidden two']);
  await page.bringToFront();

  await view.expectEndsWith(['before', 'while hidden one', 'while hidden two']);
});
