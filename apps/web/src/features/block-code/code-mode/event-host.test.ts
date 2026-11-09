import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventStreamOptions } from '../queries/document-events';
import {
  attachEventHost,
  eventEntityId,
  MAX_SUBSCRIPTIONS,
} from './event-host';

vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    span: (
      _name: string,
      operation: (span: { setAttr: () => void; error: () => void }) => unknown
    ) => operation({ setAttr: () => {}, error: () => {} }),
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
        options.onOpen?.();
      })
  );
  const latest = () => {
    const open = opens.at(-1);
    if (!open) throw new Error('no stream is open');
    return open;
  };
  return { stream, opens, latest };
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

    expect(posted).toEqual([
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
        metadata: { message_id: 'm', channel_id: 'c', document_id: 'd' },
      })
    ).toBe('m');
    expect(
      eventEntityId('agent_session.opened', { metadata: { document_id: 'd' } })
    ).toBeNull();
    expect(eventEntityId('document.updated', { metadata: {} })).toBeNull();
    expect(eventEntityId('document.updated', 'x')).toBeNull();
  });
});
