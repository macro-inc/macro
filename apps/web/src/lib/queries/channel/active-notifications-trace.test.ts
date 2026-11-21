import { describe, expect, it, vi } from 'vitest';
import { createReadTrace } from './active-notifications-trace';

type FakeSpan = {
  name: string;
  parent: string | undefined;
  attrs: Record<string, unknown>;
  errors: unknown[];
  ended: boolean;
};

const { spans, active } = vi.hoisted(() => ({
  spans: [] as FakeSpan[],
  active: [] as string[],
}));

function within<T>(name: string, work: () => T): T {
  active.push(name);
  try {
    return work();
  } finally {
    active.pop();
  }
}

vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    span: (name: string) => {
      const span: FakeSpan = {
        name,
        parent: active.at(-1),
        attrs: {},
        errors: [],
        ended: false,
      };
      spans.push(span);
      return {
        run: <T>(work: () => T) => within(name, work),
        setAttr: (key: string, value: unknown) => {
          span.attrs[key] = value;
        },
        error: (error: unknown) => span.errors.push(error),
        end: () => {
          span.ended = true;
        },
      };
    },
  },
}));

const sentIn = (run: (work: () => string | undefined) => string | undefined) =>
  run(() => active.at(-1));

describe('createReadTrace', () => {
  it('opens one span with the first request, under the loading view', () => {
    spans.length = 0;
    const flow = { run: <T>(work: () => T) => within('view.channel', work) };
    const read = createReadTrace({ channelId: 'c1', limit: 200, flow });

    expect(spans).toHaveLength(0);
    expect(sentIn(read.context.run)).toBe('channel.active_notifications.read');
    expect(spans).toEqual([
      expect.objectContaining({
        parent: 'view.channel',
        attrs: { 'channel.id': 'c1', 'notification.limit': 200 },
        ended: false,
      }),
    ]);

    read.finish({ count: 200 });
    expect(spans[0]?.attrs).toMatchObject({
      'notification.count': 200,
      'notification.limit_reached': true,
    });
    expect(spans[0]?.ended).toBe(true);

    // Later refreshes are not part of the first read.
    expect(sentIn(read.context.run)).toBeUndefined();
    expect(spans).toHaveLength(1);
  });

  it('records a failed or abandoned read, and none for a cached answer', () => {
    spans.length = 0;
    const cached = createReadTrace({
      channelId: 'c1',
      limit: 200,
      flow: undefined,
    });
    cached.finish({ count: 3 });
    expect(spans).toHaveLength(0);

    const failed = createReadTrace({
      channelId: 'c1',
      limit: 200,
      flow: undefined,
    });
    sentIn(failed.context.run);
    const error = new Error('offline');
    failed.finish({ error });
    expect(spans[0]).toMatchObject({
      parent: undefined,
      errors: [error],
      ended: true,
    });

    const left = createReadTrace({
      channelId: 'c2',
      limit: 200,
      flow: undefined,
    });
    sentIn(left.context.run);
    left.finish({ cancelled: true });
    expect(spans[1]?.attrs['read.cancelled']).toBe(true);
  });
});
