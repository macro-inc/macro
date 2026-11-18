import { WebsocketEvent } from '@macro-inc/collaboration/websocket';
import { Telemetry } from '@macro-inc/observability';
import { createClient, type Operation } from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { map, pipe, tap } from 'wonka';
import { useEmailFocusQuery } from './focus';

const socket = vi.hoisted(() => ({
  messages: new Set<(message: { type: string; data: unknown }) => void>(),
  reconnects: new Set<() => void>(),
}));

// Exercise the real query binding without UI barrels or live connections.
vi.mock('@service-connection/websocket', async () => ({
  ...(await import('@service-connection/websocket-payload')),
  createConnectionWebsocketEffect: (
    callback: (message: { type: string; data: unknown }) => void
  ) => {
    socket.messages.add(callback);
  },
  ws: {
    addEventListener: (event: WebsocketEvent, callback: () => void) => {
      if (event === WebsocketEvent.Reconnect) socket.reconnects.add(callback);
    },
    removeEventListener: (event: WebsocketEvent, callback: () => void) => {
      if (event === WebsocketEvent.Reconnect)
        socket.reconnects.delete(callback);
    },
  },
}));
vi.mock('@entity', () => ({ isEmailEntity: () => true }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => client,
  mapGraphqlSoupItem: () => undefined,
}));
vi.mock('../soup/transform-utils', () => ({
  isDisplayableSoupItem: () => false,
  mapApiSoupItemToEntity: () => undefined,
}));

const reads: Operation[] = [];
const client = createClient({
  url: '/graphql',
  exchanges: [
    () => (operations) =>
      pipe(
        operations,
        tap((operation: Operation) => {
          if (operation.kind === 'query') reads.push(operation);
        }),
        map((operation: Operation) => ({
          operation,
          data: { user: { id: 'viewer', emailFocus: [] } },
          stale: false,
          hasNext: false,
        }))
      ),
  ],
});

function push(data: unknown, type = 'refresh_email') {
  for (const message of socket.messages) {
    message({ type, data: JSON.stringify(data) });
  }
}

const FOCUS_UPDATED = { event: 'focus_updated', link_id: 'inbox' };

let visibility: DocumentVisibilityState;
let dispose: (() => void) | undefined;

function setVisibility(value: DocumentVisibilityState) {
  visibility = value;
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Mount the Focus list and settle its first read. */
async function mount(enabled = true) {
  const [isEnabled, setEnabled] = createSignal(enabled);
  dispose = createRoot((disposeRoot) => {
    useEmailFocusQuery(isEnabled);
    return disposeRoot;
  });
  await vi.advanceTimersByTimeAsync(0);
  reads.length = 0;
  return { setEnabled };
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
    () => visibility
  );
  reads.length = 0;
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  socket.messages.clear();
  socket.reconnects.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useEmailFocusQuery', () => {
  it('reads Focus from the server when the worker stores a classification', async () => {
    await mount();

    push(FOCUS_UPDATED);
    await vi.advanceTimersByTimeAsync(0);

    expect(reads).toHaveLength(1);
    expect(reads[0]?.context.requestPolicy).toBe('network-only');
    expect(reads[0]?.variables).toEqual({ days: 30 });
  });

  it('turns a burst of pushes into few reads', async () => {
    await mount();

    for (let index = 0; index < 20; index++) push(FOCUS_UPDATED);
    await vi.advanceTimersByTimeAsync(1_000);

    // At once, then one for everything that came while it was throttled.
    expect(reads).toHaveLength(2);
  });

  it('ignores other inbox refreshes and other messages', async () => {
    await mount();

    push({ event: 'upsert_message', link_id: 'inbox' });
    push(FOCUS_UPDATED, 'message_update');
    await vi.advanceTimersByTimeAsync(1_000);

    expect(reads).toHaveLength(0);
  });

  it('holds a hidden tab to one read when it next shows', async () => {
    await mount();
    setVisibility('hidden');

    push(FOCUS_UPDATED);
    push(FOCUS_UPDATED);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reads).toHaveLength(0);

    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reads).toHaveLength(1);
  });

  it('reads when a hidden tab shows, in case a push was lost', async () => {
    await mount();
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reads).toHaveLength(0);

    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reads).toHaveLength(1);
  });

  it('leaves a closed Focus tab to read when it opens', async () => {
    const { setEnabled } = await mount(false);

    push(FOCUS_UPDATED);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reads).toHaveLength(0);

    setEnabled(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reads).toHaveLength(1);
  });

  it('reads again after a reconnect that may have missed a push', async () => {
    await mount();

    for (const reconnect of socket.reconnects) reconnect();
    await vi.advanceTimersByTimeAsync(0);

    expect(reads).toHaveLength(1);
  });

  it('stops listening when it unmounts', async () => {
    await mount();
    dispose?.();
    dispose = undefined;

    for (const reconnect of socket.reconnects) reconnect();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(socket.reconnects.size).toBe(0);
    expect(reads).toHaveLength(0);
  });

  it('joins the trace the push carries', async () => {
    const remoteContext = vi.spyOn(Telemetry, 'remoteContext');
    await mount();
    const traceparent =
      '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

    push({ ...FOCUS_UPDATED, traceparent });
    await vi.advanceTimersByTimeAsync(0);

    expect(remoteContext).toHaveBeenCalledWith(traceparent);
    expect(reads[0]?.context.macroTraceParent).toBeDefined();
  });
});
