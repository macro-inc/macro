import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const [authenticated, setAuthenticated] = createSignal<boolean | undefined>();
const [userId, setUserId] = createSignal<string | undefined>();
const sockets = vi.hoisted(() => ({
  gateway: { reconnect: vi.fn(), close: vi.fn(), buffer: { read: vi.fn() } },
  storage: { reconnect: vi.fn(), close: vi.fn() },
  stopGateway: vi.fn(),
  stopStorage: vi.fn(),
  activateGateway: vi.fn(),
  activateStorage: vi.fn(),
}));
const telemetry = vi.hoisted(() => ({
  hash: vi.fn(),
  roots: [] as {
    name: string;
    span: { setAttr: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    completed: Promise<void>;
  }[],
}));
vi.mock('@core/util/hash', () => ({ contentHash: telemetry.hash }));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    anonymousSpan: (name: string) => {
      const completed = Promise.withResolvers<void>();
      const span = { setAttr: vi.fn(), end: vi.fn(() => completed.resolve()) };
      telemetry.roots.push({ name, span, completed: completed.promise });
      return span;
    },
  },
}));
vi.mock('@core/context/user', () => ({
  useIsAuthenticated: () => authenticated,
  useUserId: () => userId,
}));
vi.mock('@service-connection/websocket', () => ({
  ws: sockets.gateway,
  connectionGatewaySessionTelemetry: { activate: sockets.activateGateway },
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: sockets.storage,
  storageSessionTelemetry: { activate: sockets.activateStorage },
}));

import { useSessionWebsockets } from './session-websockets';

let dispose: (() => void) | undefined;
beforeEach(() => {
  telemetry.hash.mockResolvedValue('opaque-user-hash');
  sockets.activateGateway.mockReturnValue(sockets.stopGateway);
  sockets.activateStorage.mockReturnValue(sockets.stopStorage);
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  setAuthenticated(undefined);
  setUserId(undefined);
  telemetry.roots.length = 0;
  vi.clearAllMocks();
});

it('starts only for authenticated identities, drains on logout, and replaces account sessions', async () => {
  createRoot((cleanup) => {
    dispose = cleanup;
    useSessionWebsockets();
  });
  expect(sockets.gateway.reconnect).not.toHaveBeenCalled();
  setUserId('alice');
  setAuthenticated(false);
  expect(sockets.gateway.reconnect).not.toHaveBeenCalled();

  setAuthenticated(true);
  expect(sockets.gateway.reconnect).toHaveBeenCalledOnce();
  expect(sockets.storage.reconnect).toHaveBeenCalledOnce();
  setUserId('bob');
  expect(sockets.gateway.close).toHaveBeenCalledOnce();
  expect(sockets.storage.close).toHaveBeenCalledOnce();
  expect(sockets.gateway.reconnect).toHaveBeenCalledTimes(2);

  sockets.gateway.buffer.read.mockReturnValueOnce({ type: 'track_entity' });
  setAuthenticated(false);
  expect(sockets.gateway.close).toHaveBeenCalledTimes(2);
  expect(sockets.storage.close).toHaveBeenCalledTimes(2);
  expect(sockets.gateway.buffer.read).toHaveBeenCalledTimes(3);

  setAuthenticated(true);
  expect(sockets.gateway.reconnect).toHaveBeenCalledTimes(3);
  dispose?.();
  dispose = undefined;
  expect(sockets.gateway.close).toHaveBeenCalledTimes(3);
  expect(sockets.storage.close).toHaveBeenCalledTimes(3);
  expect(sockets.stopGateway).toHaveBeenCalledTimes(3);
  expect(sockets.stopStorage).toHaveBeenCalledTimes(3);
  await Promise.all(telemetry.roots.map((root) => root.completed));
  expect(telemetry.roots).toHaveLength(3);
  for (const root of telemetry.roots) {
    expect(root.name).toBe('auth.session_websockets.activate');
    expect(root.span.setAttr).toHaveBeenCalledWith(
      'user.id_hash',
      'opaque-user-hash'
    );
    expect(root.span.end).toHaveBeenCalledOnce();
    expect(sockets.activateGateway).toHaveBeenCalledWith(root.span);
    expect(sockets.activateStorage).toHaveBeenCalledWith(root.span);
  }
  expect(
    JSON.stringify(telemetry.roots.map((root) => root.span.setAttr.mock.calls))
  ).not.toMatch(/alice|bob/);
});

it('ends activation spans and connects even when identity hashing fails', async () => {
  telemetry.hash.mockRejectedValue(new Error('unavailable'));
  setUserId('macro|private@example.test');
  setAuthenticated(true);
  createRoot((cleanup) => {
    dispose = cleanup;
    useSessionWebsockets();
  });
  expect(sockets.gateway.reconnect).toHaveBeenCalledOnce();
  await telemetry.roots[0].completed;
  expect(telemetry.roots[0].span.setAttr).toHaveBeenCalledWith(
    'user.id_hash_unavailable',
    true
  );
  expect(telemetry.roots[0].span.end).toHaveBeenCalledOnce();
});
