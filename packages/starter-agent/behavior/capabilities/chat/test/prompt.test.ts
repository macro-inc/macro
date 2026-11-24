import { expect, test } from 'bun:test';
import { type Queued, Queued as QueuedSchema } from '../entry.ts';
import { replyPrompt, rescueTask } from '../prompt.ts';

const traceparent = `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`;
const message: Queued = {
  id: 'm1',
  root: 'm1',
  thread: null,
  dm: true,
  from: 'Ada',
  sender_id: 'macro|ada@example.com',
  at: '2026-11-19T12:00:00Z',
  text: 'make a channel',
  channel_id: 'dm1',
  channel: 'Ada',
  mentioned: false,
  p: { addressed: 1 },
  traceparent,
};
const conversation = { channelId: 'dm1', channel: 'Ada', messages: [message] };

test("a queued message's trace context never reaches the model", () => {
  const reply = replyPrompt(conversation, []);
  const rescue = rescueTask(conversation, 'failed');
  for (const prompt of [reply, rescue]) {
    expect(prompt).toContain('make a channel');
    expect(prompt).not.toContain('traceparent');
    expect(prompt).not.toContain(traceparent);
  }
});

test('the prompt is what it was without telemetry', () => {
  const { traceparent: _, ...untraced } = message;
  const plain = { ...conversation, messages: [untraced] };
  expect(replyPrompt(conversation, [])).toBe(replyPrompt(plain, []));
  expect(rescueTask(conversation, 'failed')).toBe(rescueTask(plain, 'failed'));
});

test('a malformed trace context is dropped when a queued message is read back', () => {
  expect(
    QueuedSchema.parse({ ...message, traceparent: 'not-a-trace' }).traceparent
  ).toBeUndefined();
  expect(QueuedSchema.parse(message).traceparent).toBe(traceparent);
});
