// @vitest-environment jsdom
import { renderHook, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import type { ConnectScreen } from '../context/screen-context';
import { createScreenConnection } from './screen-connection';

it('reconnects for control and revokes it when edit permission is lost', async () => {
  const [canEdit, setCanEdit] = createSignal(true);
  const disconnect = vi.fn();
  const resolveUrl = vi.fn(async (_id: string, control: boolean) =>
    control ? 'wss://screen?control=true' : 'wss://screen'
  );
  const connect = vi.fn<ConnectScreen>(async () => ({ disconnect }));
  const { result, cleanup } = renderHook(() =>
    createScreenConnection(
      {
        sessionId: () => 'session',
        harnessId: () => 'computer',
        canEdit,
        touch: () => false,
        resolveUrl,
      },
      () => document.createElement('div'),
      connect
    )
  );
  await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
  result.toggleControl();
  await waitFor(() => expect(connect).toHaveBeenCalledTimes(2));
  expect(connect.mock.calls[1]?.[2]).toBe(true);
  expect(disconnect).toHaveBeenCalledTimes(1);
  setCanEdit(false);
  await waitFor(() => expect(connect).toHaveBeenCalledTimes(3));
  expect(connect.mock.calls[2]?.[2]).toBe(false);
  expect(result.controlling()).toBe(false);
  setCanEdit(true);
  expect(result.controlling()).toBe(false);
  cleanup();
  expect(disconnect).toHaveBeenCalledTimes(3);
});

it.each([
  { edit: false, touch: false },
  { edit: true, touch: true },
])('keeps watch-only for %j', async ({ edit, touch }) => {
  const resolveUrl = vi.fn(async () => 'wss://screen');
  const connect = vi.fn<ConnectScreen>(async () => ({ disconnect: vi.fn() }));
  const { result } = renderHook(() =>
    createScreenConnection(
      {
        sessionId: () => 'session',
        harnessId: () => 'computer',
        canEdit: () => edit,
        touch: () => touch,
        resolveUrl,
      },
      () => document.createElement('div'),
      connect
    )
  );
  result.toggleControl();
  await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
  expect(result.canControl()).toBe(false);
  expect(result.controlling()).toBe(false);
  expect(resolveUrl).toHaveBeenCalledWith('computer', false);
});

it('does not connect after an authorization request outlives the pane', async () => {
  let resolve: (url: string) => void = () => {};
  const authorized = new Promise<string>((done) => {
    resolve = done;
  });
  const connect = vi.fn<ConnectScreen>(async () => ({ disconnect: vi.fn() }));
  const { cleanup } = renderHook(() =>
    createScreenConnection(
      {
        sessionId: () => 'session',
        harnessId: () => 'computer',
        canEdit: () => true,
        touch: () => false,
        resolveUrl: () => authorized,
      },
      () => document.createElement('div'),
      connect
    )
  );
  cleanup();
  resolve('wss://screen');
  await authorized;
  expect(connect).not.toHaveBeenCalled();
});

it('keeps control and its connection when polling refreshes the same harness', async () => {
  const [harness, setHarness] = createSignal({
    id: 'computer',
    connected: true,
  });
  const connect = vi.fn<ConnectScreen>(async () => ({ disconnect: vi.fn() }));
  const { result, cleanup } = renderHook(() =>
    createScreenConnection(
      {
        sessionId: () => 'session',
        harnessId: () => harness().id,
        canEdit: () => true,
        touch: () => false,
        resolveUrl: async () => 'wss://screen',
      },
      () => document.createElement('div'),
      connect
    )
  );
  await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
  result.toggleControl();
  await waitFor(() => expect(connect).toHaveBeenCalledTimes(2));
  setHarness({ id: 'computer', connected: true });
  await waitFor(() => expect(result.controlling()).toBe(true));
  expect(connect).toHaveBeenCalledTimes(2);
  cleanup();
});
