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
  const stream = streamOutages(trace, 60_000);

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
      attributes: {
        'chat.events.reconnects': 1,
        'chat.events.reopened': true,
      },
      ended: true,
    },
    {
      name: 'chat.events.reconnect',
      attributes: {
        'chat.events.reconnects': 2,
        'chat.events.reopened': true,
      },
      ended: true,
    },
  ]);
});

test('an outage that outlasts the longest span ends it as not reopened, so it is exported', async () => {
  const attributes: Record<string, unknown> = {};
  const ended = Promise.withResolvers<void>();
  const trace: Trace = async (_name, run) => {
    const result = await run({
      set: (key, value) => {
        attributes[key] = value;
      },
      traceparent: () => undefined,
    });
    ended.resolve();
    return result;
  };

  streamOutages(trace, 5).dropped();
  await ended.promise;

  expect(attributes).toEqual({
    'chat.events.reconnects': 1,
    'chat.events.reopened': false,
  });
});
