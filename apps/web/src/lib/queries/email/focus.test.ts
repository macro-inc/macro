import { WebsocketEvent } from '@macro-inc/collaboration/websocket';
import { Telemetry } from '@macro-inc/observability';
import { CombinedError, createClient, type Operation } from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { map, pipe, tap } from 'wonka';
import { isOpenRead, useEmailFocusQuery } from './focus';

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
/** What `onOpenRead` heard, in order. */
const openReads: number[] = [];
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
    useEmailFocusQuery(isEnabled, (threads) => openReads.push(threads));
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
  openReads.length = 0;
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

describe('onOpenRead', () => {
  it('hears the read the tab makes as it opens, once', async () => {
    await mount();
    expect(openReads).toEqual([0]);
  });

  it('does not hear refreshes', async () => {
    await mount();

    push(FOCUS_UPDATED);
    for (const reconnect of socket.reconnects) reconnect();
    setVisibility('hidden');
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(1_000);

    expect(reads.length).toBeGreaterThan(0);
    expect(openReads).toEqual([0]);
  });

  it('hears each visit: leaving the tab and coming back reads again', async () => {
    const { setEnabled } = await mount(false);
    expect(openReads).toEqual([]);

    setEnabled(true);
    await vi.advanceTimersByTimeAsync(0);
    setEnabled(false);
    setEnabled(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(openReads).toEqual([0, 0]);
  });
});

describe('isOpenRead', () => {
  const read = (
    requestPolicy: 'cache-and-network' | 'network-only' | 'cache-first',
    result: {
      stale?: boolean;
      error?: boolean;
      data?: unknown;
      /** Where the normalized cache says the answer came from. */
      source?: string;
    } = {}
  ) =>
    isOpenRead({
      operation: { context: { requestPolicy } } as Operation,
      data: 'data' in result ? result.data : { user: { emailFocus: [] } },
      error: result.error ? new CombinedError({}) : undefined,
      extensions: result.source
        ? { __macroNormalizedCache: { source: result.source } }
        : undefined,
      stale: result.stale ?? false,
      hasNext: false,
    });

  it('is the server answer to the opening read', () => {
    expect(read('cache-and-network')).toBe(true);
    expect(read('cache-and-network', { source: 'live-network' })).toBe(true);
  });

  it('is not the cached answer shown first, a failure, or a refresh', () => {
    expect(read('cache-and-network', { stale: true })).toBe(false);
    expect(read('cache-and-network', { error: true })).toBe(false);
    expect(read('cache-and-network', { data: undefined })).toBe(false);
    expect(read('network-only')).toBe(false);
    // The cache reading again after a write it holds.
    expect(read('cache-first')).toBe(false);
    expect(read('cache-and-network', { source: 'affected-cache-reread' })).toBe(
      false
    );
    expect(read('cache-and-network', { source: 'normalized-cache-hit' })).toBe(
      false
    );
  });
});
