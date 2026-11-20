import { expect, test } from 'bun:test';
import type { Trace } from '../../../agent/claude.ts';
import { streamOutages } from '../context.ts';

test('each drop of the events stream is a reconnect span that lasts until the stream reopens, with the running count', async () => {
  const spans: {
    name: string;
    attributes: Record<string, unknown>;
    ended: boolean;
  }[] = [];
  const trace: Trace = async (name, run) => {
    const span = {
      name,
      attributes: {} as Record<string, unknown>,
      ended: false,
    };
    spans.push(span);
    const result = await run({
      set: (key, value) => {
        span.attributes[key] = value;
      },
      traceparent: () => undefined,
    });
    span.ended = true;
    return result;
  };
  const stream = streamOutages(trace);

  stream.opened();
  stream.dropped();
  await Promise.resolve();
  expect(spans).toEqual([
    {
      name: 'chat.events.reconnect',
      attributes: { 'chat.events.reconnects': 1 },
      ended: false,
    },
  ]);

  stream.opened();
  stream.dropped();
  stream.opened();
  await Bun.sleep(0);

  expect(spans).toEqual([
    {
      name: 'chat.events.reconnect',
      attributes: { 'chat.events.reconnects': 1 },
      ended: true,
    },
    {
      name: 'chat.events.reconnect',
      attributes: { 'chat.events.reconnects': 2 },
      ended: true,
    },
  ]);
});
