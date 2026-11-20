import { expect, test } from 'bun:test';
import type { Trace } from '../../../agent/claude.ts';
import { streamDrops } from '../context.ts';

test('each drop of the events stream is a reconnect span with the running count and the refusal status', () => {
  const spans: { name: string; attributes: Record<string, unknown> }[] = [];
  const trace: Trace = async (name, run) => {
    const attributes: Record<string, unknown> = {};
    spans.push({ name, attributes });
    return run({
      set: (key, value) => {
        attributes[key] = value;
      },
      traceparent: () => undefined,
    });
  };
  const dropped = streamDrops(trace);

  dropped(new Error('SSE failed: 503 Service Unavailable'));
  dropped(new TypeError('fetch failed'));

  expect(spans).toEqual([
    {
      name: 'chat.events.reconnect',
      attributes: {
        'chat.events.reconnects': 1,
        'error.type': 'Error',
        'http.response.status_code': 503,
      },
    },
    {
      name: 'chat.events.reconnect',
      attributes: { 'chat.events.reconnects': 2, 'error.type': 'TypeError' },
    },
  ]);
});
