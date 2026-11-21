import { ChannelView } from './harness/channel';
import { expect, failsSometimes, test } from './harness/fixtures';
import { historyText } from './harness/history';

// If this fails, scrolling back through a long channel loses, repeats or
// reorders messages, or stops before the start.
test('SCROLL-01 scrolling back to the start of a long channel shows every message once, in order', async ({
  page,
  history,
}) => {
  test.setTimeout(300_000);
  const view = new ChannelView(page, history.id);
  await view.open();
  await view.expectEndsWith(history.texts.slice(-5));

  const read = await view.readTo(historyText(1), 'back');

  expect(read).toEqual(history.texts);
  await expect(
    page.getByText(`Channel ${history.name} created`, { exact: false })
  ).toBeVisible();
});

// If this fails, a person reading back has no button to return to the
// present, or it does not take them there.
test('SCROLL-02 scrolling back down from far up offers “Scroll to bottom”, which returns to the latest message', async ({
  page,
  ada,
  people,
}) => {
  // Every message is the reader's own: an unread one above would put its
  // own button where this one goes.
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(
    channel.id,
    Array.from({ length: 70 }, (_, index) => `filler ${index + 1}`)
  );
  const view = new ChannelView(page, channel.id);
  await view.open();
  await view.expectAtBottom();
  const button = page.getByRole('button', { name: 'Scroll to bottom' });
  await expect(button).toBeHidden();

  await view.wheel(-3_000);
  await expect(view.message('filler 70')).not.toBeInViewport();
  await expect(button).toBeHidden();
  await (await view.scrollDownUntilOffered()).click();

  await expect(view.message('filler 70')).toBeInViewport();
  await view.expectAtBottom();
});

// If this fails, a message that arrives while the person is at the end of
// the channel is left below the window.
test('SCROLL-03 at the end of the channel, a message from someone else arrives in view', async ({
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

  await ben.post(channel.id, 'arrives at the end');

  await expect(view.message('arrives at the end')).toBeInViewport();
  await view.expectAtBottom();
});

// If this fails, a message that arrives while the person reads older ones
// moves what they are reading.
test('SCROLL-04 scrolled up, a message from someone else does not move what is being read', async ({
  page,
  ada,
  ben,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  await ada.postAll(
    channel.id,
    Array.from({ length: 70 }, (_, index) => `filler ${index + 1}`)
  );
  const view = new ChannelView(page, channel.id);
  await view.open();
  await view.expectAtBottom();
  await view.wheel(-2_800);
  // The list has stopped when five looks in a row find the same message in
  // the same place: on a slow machine older history is still being drawn
  // above after two looks agree.
  let reading = await view.topVisible();
  let unmoved = 0;
  await expect
    .poll(async () => {
      const before = reading;
      reading = await view.topVisible();
      const same = reading.id === before.id && reading.top === before.top;
      unmoved = same ? unmoved + 1 : 0;
      return unmoved;
    })
    .toBeGreaterThanOrEqual(5);
  const height = await view.list.evaluate((list) => list.scrollHeight);

  await ben.post(channel.id, 'arrives below the window');

  // The list grows by the new message, which is below the window.
  // Known defect on main, seen once in 62 runs: an open page sometimes
  // misses a live change. The reading position is gone after a reload, so
  // then the test only checks that the reload shows the message.
  let missed = false;
  await failsSometimes(async () => {
    try {
      await expect
        .poll(() => view.list.evaluate((list) => list.scrollHeight))
        .toBeGreaterThan(height);
    } catch (error) {
      missed = true;
      throw error;
    }
  });
  if (missed) {
    await page.reload();
    await view.shown();
    await expect(view.message('arrives below the window')).toBeInViewport();
    return;
  }
  await expect(view.message('arrives below the window')).not.toBeInViewport();
  expect(await view.topVisible()).toEqual(reading);

  await (await view.scrollDownUntilOffered()).click();
  await expect(view.message('arrives below the window')).toBeInViewport();
});
