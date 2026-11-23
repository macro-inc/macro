import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshOnSavedViewChanges } from './saved-view-changes';

type Message = { type: string; data: unknown };

const gateway = vi.hoisted(() => ({
  push: undefined as ((message: Message) => void) | undefined,
  reconnect: undefined as (() => void) | undefined,
}));

vi.mock('@service-connection/websocket', () => ({
  ws: {},
  createConnectionWebsocketEffect: (callback: (message: Message) => void) => {
    gateway.push = callback;
  },
}));
vi.mock('@macro-inc/collaboration/websocket', () => ({
  createReconnectEffect: (_ws: unknown, callback: () => void) => {
    gateway.reconnect = callback;
  },
}));

function listen(kind: string | undefined) {
  const refresh = vi.fn(async () => {});
  createRoot(() => refreshOnSavedViewChanges(kind, refresh));
  return refresh;
}

const changed = (data: unknown) =>
  gateway.push?.({ type: 'saved_views_changed', data });

beforeEach(() => {
  gateway.push = undefined;
  gateway.reconnect = undefined;
});

describe('refreshOnSavedViewChanges', () => {
  it('re-reads a kind on its own pushes and on unknown kinds', () => {
    const refresh = listen('email');

    changed({ kind: 'task' });
    expect(refresh).not.toHaveBeenCalled();

    changed({ kind: 'email' });
    changed(JSON.stringify({ kind: null }));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('re-reads on every push when it reads no particular kind', () => {
    const refresh = listen(undefined);

    changed({ kind: 'task' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('ignores other messages and malformed pushes', () => {
    const refresh = listen('email');

    gateway.push?.({ type: 'external_chat_changed', data: { kind: 'email' } });
    changed({ kind: 3 });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('re-reads after a reconnect, which may have missed a push', () => {
    const refresh = listen('email');

    gateway.reconnect?.();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
