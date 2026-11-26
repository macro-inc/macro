import { ChannelView, conversationRow } from './harness/channel';
import { expect, test } from './harness/fixtures';

function numbered(prefix: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${prefix} ${String(index + 1).padStart(3, '0')}`
  );
}

// If this fails, a person who opens a channel does not see its latest
// messages, or sees them out of order.
test('OPEN-01 a channel opened by its address shows its latest messages in order, at the end', async ({
  page,
  ada,
  ben,
  people,
}) => {
  const channel = await ada.createChannel({ members: [people.ben] });
  const texts = numbered('open', 12);
  for (const [index, text] of texts.entries()) {
    await (index % 2 === 0 ? ada : ben).post(channel.id, text);
  }

  const view = new ChannelView(page, channel.id);
  await view.open();

  await view.expectEndsWith(texts);
  await view.expectAtBottom();
  await expect(view.message('open 012')).toBeInViewport();
});

// If this fails, choosing a conversation in the list shows the wrong
// channel's messages, or keeps showing the previous one's.
test('OPEN-02 switching between channels in the list shows each channel’s own messages', async ({
  page,
  ada,
  people,
}) => {
  const first = await ada.createChannel({ members: [people.ben] });
  const second = await ada.createChannel({ members: [people.ben] });
  const firstTexts = numbered('first', 5);
  const secondTexts = numbered('second', 7);
  await ada.postAll(first.id, firstTexts);
  await ada.postAll(second.id, secondTexts);

  const firstView = new ChannelView(page, first.id);
  const secondView = new ChannelView(page, second.id);
  await firstView.open();
  await firstView.expectEndsWith(firstTexts);

  await conversationRow(page, second.name).click();
  await secondView.shown();
  await secondView.expectEndsWith(secondTexts);
  await expect(firstView.message('first 005')).toHaveCount(0);

  await conversationRow(page, first.name).click();
  await firstView.shown();
  await firstView.expectEndsWith(firstTexts);
  await expect(secondView.message('second 007')).toHaveCount(0);
});
