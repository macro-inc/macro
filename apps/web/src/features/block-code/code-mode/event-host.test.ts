import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type EventStreamOptions,
  EventStreamRefused,
} from '../queries/document-events';
import {
  attachEventHost,
  eventEntityId,
  MAX_SUBSCRIPTIONS,
} from './event-host';

vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    span: (
      _name: string,
      operation: (span: {
        setAttr: () => void;
        error: () => void;
        injectTraceHeaders: (headers: Record<string, string>) => void;
      }) => unknown
    ) =>
      operation({
        setAttr: () => {},
        error: () => {},
        injectTraceHeaders: (headers) => {
          headers.traceparent = '00-trace-span-01';
        },
      }),
  },
}));

/** A real (jsdom) frame that records what the host posts and can message it. */
function fakeFrame() {
  const posted: unknown[] = [];
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  const contentWindow = frame.contentWindow;
  if (!contentWindow) throw new Error('jsdom gave the frame no window');
  vi.spyOn(contentWindow, 'postMessage').mockImplementation(
    (message: unknown) => {
      posted.push(message);
    }
  );
  const send = (data: unknown) =>
    window.dispatchEvent(
      new MessageEvent('message', { data, source: contentWindow })
    );
  return { frame, posted, send };
}

/**
 * A controllable server stream: each open is recorded and stays open until
 * the test ends or fails it, or the host aborts it.
 */
function fakeStream() {
  const opens: Array<{
    options: EventStreamOptions;
    end: () => void;
    fail: () => void;
  }> = [];
  /** Errors the next opens fail with before opening, in order. */
  const refusals: Error[] = [];
  const stream = vi.fn(
    (options: EventStreamOptions) =>
      new Promise<void>((resolve, reject) => {
        options.signal.addEventListener('abort', () => resolve(), {
          once: true,
        });
        opens.push({
          options,
          end: resolve,
          fail: () => reject(new Error('dropped')),
        });
        const refusal = refusals.shift();
        if (refusal) return reject(refusal);
        options.onOpen?.();
      })
  );
  const latest = () => {
    const open = opens.at(-1);
    if (!open) throw new Error('no stream is open');
    return open;
  };
  return { stream, opens, latest, refusals };
}

const subscribe = (subscription: number, events: string[], ids?: string[]) => ({
  type: 'macro:subscribe',
  token: 't',
  subscription,
  events,
  ...(ids ? { ids } : {}),
});

const documentEvent = (name: string, documentId: string) => ({
  name,
  data: {
    event_type: name,
    metadata: { document_id: documentId, secret: 'x' },
  },
});

const messageEvent = (name: string, channelId: string) => ({
  name,
  data: {
    event_type: name,
    metadata: {
      message_id: 'm1',
      parent: { type: 'channel', id: channelId },
    },
  },
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('attachEventHost', () => {
  const detachers: Array<() => void> = [];
  afterEach(() => {
    for (const detach of detachers.splice(0)) detach();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function attach() {
    const frame = fakeFrame();
    const server = fakeStream();
    detachers.push(
      attachEventHost(frame.frame, {
        documentId: 'doc',
        token: 't',
        stream: server.stream,
      })
    );
    return { ...frame, ...server };
  }

  it('opens one stream for a subscription and forwards only name and id', async () => {
    const { send, posted, opens, latest } = attach();
    send(subscribe(1, ['document.created', 'document.updated']));
    await flush();

    expect(opens).toHaveLength(1);
    expect(latest().options.filters).toEqual([
      { events: ['document.created', 'document.updated'] },
    ]);

    latest().options.onEvent(documentEvent('document.updated', 'd1'));
    latest().options.onEvent(documentEvent('channel.updated', 'c1'));

    expect(posted).toEqual([
      {
        type: 'macro:event',
        token: 't',
        subscription: 1,
        event: { type: 'document.updated', id: 'd1' },
      },
    ]);
  });

  it('narrows delivery to the subscription’s ids', async () => {
    const { send, posted, latest } = attach();
    send(subscribe(1, ['document.updated'], ['d2']));
    await flush();

    expect(latest().options.filters).toEqual([
      { events: ['document.updated'], ids: ['d2'] },
    ]);
    latest().options.onEvent(documentEvent('document.updated', 'd1'));
    latest().options.onEvent(documentEvent('document.updated', 'd2'));

    expect(posted).toEqual([
      expect.objectContaining({
        subscription: 1,
        event: { type: 'document.updated', id: 'd2' },
      }),
    ]);
  });

  it('reopens with the union of subscriptions and closes on the last unsubscribe', async () => {
    const { send, opens, latest } = attach();
    send(subscribe(1, ['document.updated']));
    await flush();
    send(subscribe(2, ['message.posted']));
    await flush();

    expect(opens).toHaveLength(2);
    expect(opens[0]?.options.signal.aborted).toBe(true);
    expect(latest().options.filters).toEqual([
      { events: ['document.updated'] },
      { events: ['message.posted'] },
    ]);

    send({ type: 'macro:unsubscribe', token: 't', subscription: 1 });
    send({ type: 'macro:unsubscribe', token: 't', subscription: 2 });
    await flush();

    expect(opens).toHaveLength(3);
    expect(latest().options.signal.aborted).toBe(true);
  });

  it('refuses invalid subscriptions without opening a stream', async () => {
    const { send, posted, opens } = attach();
    send(subscribe(1, ['not an event']));
    send(subscribe(2, []));
    await flush();

    expect(opens).toHaveLength(0);
    expect(posted).toEqual([
      expect.objectContaining({
        subscription: 1,
        event: expect.objectContaining({ type: 'macro.error', id: null }),
      }),
      expect.objectContaining({
        subscription: 2,
        event: expect.objectContaining({ type: 'macro.error', id: null }),
      }),
    ]);
  });

  it('caps the subscriptions a frame may hold', async () => {
    const { send, posted } = attach();
    for (let index = 1; index <= MAX_SUBSCRIPTIONS + 1; index += 1)
      send(subscribe(index, ['document.updated']));
    await flush();

    const errors = posted.filter(
      (message) =>
        (message as { event: { type: string } }).event.type === 'macro.error'
    );
    expect(errors).toEqual([
      expect.objectContaining({
        subscription: MAX_SUBSCRIPTIONS + 1,
        event: expect.objectContaining({ type: 'macro.error' }),
      }),
    ]);
  });

  it('ignores messages from other windows or with another token', async () => {
    const { send, opens } = attach();
    send({ ...subscribe(1, ['document.updated']), token: 'other' });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: subscribe(2, ['document.updated']),
        source: window,
      })
    );
    await flush();

    expect(opens).toHaveLength(0);
  });

  it('reconnects after a dropped stream and tells every subscription to resync', async () => {
    vi.useFakeTimers();
    const { send, posted, opens, latest } = attach();
    send(subscribe(1, ['document.updated']));
    send(subscribe(2, ['message.posted']));
    await vi.advanceTimersByTimeAsync(0);
    const before = opens.length;
    posted.length = 0;

    latest().fail();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(opens).toHaveLength(before + 1);
    expect(posted).toEqual([
      expect.objectContaining({
        subscription: 1,
        event: { type: 'macro.resync', id: null },
      }),
      expect.objectContaining({
        subscription: 2,
        event: { type: 'macro.resync', id: null },
      }),
    ]);
  });

  it('narrows message events by the conversation the server filters on', async () => {
    const { send, posted, latest } = attach();
    send(subscribe(1, ['message.posted'], ['c2']));
    await flush();

    latest().options.onEvent(messageEvent('message.posted', 'c1'));
    latest().options.onEvent(messageEvent('message.posted', 'c2'));

    expect(posted).toEqual([
      expect.objectContaining({
        subscription: 1,
        event: { type: 'message.posted', id: 'c2' },
      }),
    ]);
  });

  it('trusts the server’s ids filter for events it can’t read an id from', async () => {
    const { send, posted, latest } = attach();
    send(subscribe(1, ['agent_session.opened'], ['s1']));
    await flush();

    latest().options.onEvent({
      name: 'agent_session.opened',
      data: { event_type: 'agent_session.opened', session: { id: 's1' } },
    });

    expect(posted).toEqual([
      expect.objectContaining({
        subscription: 1,
        event: { type: 'agent_session.opened', id: null },
      }),
    ]);
  });

  it('refuses ids the server would refuse, without opening a stream', async () => {
    const { send, posted, opens } = attach();
    send(subscribe(1, ['document.updated'], []));
    send(subscribe(2, ['document.updated'], ['  ']));
    send(subscribe(3, ['document.updated'], ['x'.repeat(257)]));
    await flush();

    expect(opens).toHaveLength(0);
    expect(
      posted.map(
        (message) => (message as { subscription: number }).subscription
      )
    ).toEqual([1, 2, 3]);
    expect(posted).toEqual(
      Array(3).fill(
        expect.objectContaining({
          event: expect.objectContaining({ type: 'macro.error' }),
        })
      )
    );
  });

  it('reports a stream the server refuses and stops retrying it', async () => {
    vi.useFakeTimers();
    const { send, posted, opens, refusals } = attach();
    refusals.push(new EventStreamRefused(400));
    send(subscribe(1, ['document.updated']));
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(opens).toHaveLength(1);
    expect(posted).toEqual([
      expect.objectContaining({
        subscription: 1,
        event: expect.objectContaining({ type: 'macro.error' }),
      }),
    ]);
  });

  it('resyncs after a reopen for changed subscriptions', async () => {
    const { send, posted, latest } = attach();
    send(subscribe(1, ['document.updated']));
    await flush();
    expect(posted).toEqual([]);

    send(subscribe(2, ['message.posted']));
    await flush();

    expect(latest().options.traceHeaders).toEqual({
      traceparent: '00-trace-span-01',
    });
    expect(posted).toEqual([
      expect.objectContaining({
        subscription: 1,
        event: { type: 'macro.resync', id: null },
      }),
      expect.objectContaining({
        subscription: 2,
        event: { type: 'macro.resync', id: null },
      }),
    ]);
  });

  it('resyncs when the first open follows a failed attempt', async () => {
    vi.useFakeTimers();
    const { send, posted, opens, refusals } = attach();
    refusals.push(new Error('offline'));
    send(subscribe(1, ['document.updated']));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(opens).toHaveLength(2);
    expect(posted).toEqual([
      expect.objectContaining({
        subscription: 1,
        event: { type: 'macro.resync', id: null },
      }),
    ]);
  });

  it('starts over for a page loaded afresh in a new window', async () => {
    const frame = new EventTarget();
    const first = fakeFrame();
    const moved = Object.assign(frame, {
      contentWindow: first.frame.contentWindow,
    });
    const server = fakeStream();
    detachers.push(
      attachEventHost(moved, {
        documentId: 'doc',
        token: 't',
        stream: server.stream,
      })
    );
    first.send(subscribe(1, ['document.updated']));
    await flush();
    expect(server.opens).toHaveLength(1);

    // The frame was detached and reattached: its page loads in a new window.
    const second = fakeFrame();
    moved.contentWindow = second.frame.contentWindow;
    moved.dispatchEvent(new Event('load'));
    await flush();
    expect(server.opens[0]?.options.signal.aborted).toBe(true);

    second.send(subscribe(1, ['message.posted']));
    await flush();
    expect(server.latest().options.filters).toEqual([
      { events: ['message.posted'] },
    ]);
    server.latest().options.onEvent(documentEvent('document.updated', 'd1'));
    expect(second.posted).toEqual([]);
  });

  it('stops the stream when detached', async () => {
    const frame = fakeFrame();
    const server = fakeStream();
    const detach = attachEventHost(frame.frame, {
      documentId: 'doc',
      token: 't',
      stream: server.stream,
    });
    frame.send(subscribe(1, ['document.updated']));
    await flush();

    detach();

    expect(server.latest().options.signal.aborted).toBe(true);
    frame.send(subscribe(2, ['document.updated']));
    await flush();
    expect(server.opens).toHaveLength(1);
  });
});

describe('eventEntityId', () => {
  it('reads the id the event’s family names', () => {
    expect(
      eventEntityId('document.updated', { metadata: { document_id: 'd' } })
    ).toBe('d');
    expect(
      eventEntityId('channel.updated', { metadata: { channel_id: 'c' } })
    ).toBe('c');
    expect(
      eventEntityId('call.started', {
        metadata: { call_id: 'k', channel_id: 'c' },
      })
    ).toBe('k');
    expect(
      eventEntityId('message.posted', {
        metadata: { message_id: 'm', parent: { type: 'document', id: 'd' } },
      })
    ).toBe('d');
    expect(
      eventEntityId('agent_session.opened', { metadata: { document_id: 'd' } })
    ).toBeNull();
    expect(eventEntityId('document.updated', { metadata: {} })).toBeNull();
    expect(eventEntityId('document.updated', 'x')).toBeNull();
  });
});
