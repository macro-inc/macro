import { expect, test } from 'bun:test';
import { passthrough } from '../../../agent/claude.ts';
import { batches } from '../../../context/stream.ts';
import { join, memoryDisk } from '../../../context/test/fakes.ts';
import { type Listening, listen } from '../../../events/handlers/chat.ts';
import { conversations } from '../../../events/sources/chat.ts';
import type { Entry, Queued } from '../entry.ts';
import { history as diskHistory } from '../history.ts';
import { screen } from '../screen.ts';

const entry: Entry = {
  id: 'm1',
  root: 'm1',
  thread: null,
  dm: true,
  from: 'Ada',
  sender_id: 'macro|ada@example.com',
  at: '2026-11-19T12:00:00Z',
  text: 'are you there?',
};
const dm = { channelId: 'dm1', channel: 'Ada', entry, mentions: [] };

/** The listener over a real history on a memory disk, noting the order of its writes. */
const listening = () => {
  const history = diskHistory({
    directory: 'private/history',
    queue: 'run/queue',
    join,
    disk: memoryDisk(),
  });
  const writes: string[] = [];
  const pushed: Queued[] = [];
  const context: Listening = {
    chat: {
      me: async () => 'macro|agent@example.com',
      decide: async () => {
        throw new Error('a DM needs no screen');
      },
    },
    history: {
      recorded: history.recorded,
      recent: history.recent,
      record: async (channelId, recorded) => {
        writes.push('record');
        await history.record(channelId, recorded);
      },
      wait: async (message) => {
        writes.push('wait');
        return history.wait(message);
      },
    },
    waiting: { push: (_channelId, message) => void pushed.push(message) },
    log: { event: async () => undefined },
    relevanceScreen: async () => screen,
    trace: passthrough,
    config: { identity: { name: 'Pip' } },
  };
  return { context, history, writes, pushed };
};

test('a message for the agent is queued before it is recorded, then waits for a reply', async () => {
  const { context, writes, pushed } = listening();

  await listen(dm, context);

  expect(writes).toEqual(['wait', 'record']);
  expect(pushed.map(({ id }) => id)).toEqual(['m1']);
});

test('a message already recorded is not judged or queued again', async () => {
  const { context, writes, pushed } = listening();
  await listen(dm, context);
  writes.length = 0;

  await listen(dm, context);

  expect(writes).toEqual([]);
  expect(pushed).toHaveLength(1);
});

test('a message restored from the queue is recorded, so its redelivery is not answered twice', async () => {
  const { context, history, pushed } = listening();
  // Queued, then the process stopped before it was recorded.
  await history.wait({
    ...entry,
    channel_id: 'dm1',
    channel: 'Ada',
    mentioned: false,
    p: { addressed: 1 },
  });

  const reader = conversations({ waiting: batches<Queued>(), history })[
    Symbol.asyncIterator
  ]();
  const restored = await reader.next();
  expect(restored.done).toBe(false);
  if (restored.done) return;
  expect(restored.value.messages.map(({ id }) => id)).toEqual(['m1']);
  // It is answered, which takes it off the queue; then the replay brings it
  // again: already recorded, so it is left alone.
  await history.answered('dm1', ['m1']);
  await listen(dm, context);
  expect(pushed).toEqual([]);
});
