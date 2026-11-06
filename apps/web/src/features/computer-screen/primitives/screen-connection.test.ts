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
        mobile: () => false,
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
  { edit: false, mobile: false },
  { edit: true, mobile: true },
])('keeps watch-only for %j', async ({ edit, mobile }) => {
  const resolveUrl = vi.fn(async () => 'wss://screen');
  const connect = vi.fn<ConnectScreen>(async () => ({ disconnect: vi.fn() }));
  const { result } = renderHook(() =>
    createScreenConnection(
      {
        sessionId: () => 'session',
        harnessId: () => 'computer',
        canEdit: () => edit,
        mobile: () => mobile,
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
        mobile: () => false,
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
        mobile: () => false,
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

it.each([
  { edit: true, mobile: false, control: true },
  { edit: false, mobile: false, control: false },
  { edit: true, mobile: true, control: false },
])(
  'honors an explicit launch request only when control is allowed: %j',
  async ({ edit, mobile, control }) => {
    const connect = vi.fn<ConnectScreen>(async () => ({ disconnect: vi.fn() }));
    const { result } = renderHook(() =>
      createScreenConnection(
        {
          sessionId: () => undefined,
          harnessId: () => 'computer',
          canEdit: () => edit,
          mobile: () => mobile,
          startControlling: () => true,
          resolveUrl: async () => 'wss://screen',
        },
        () => document.createElement('div'),
        connect
      )
    );
    await waitFor(() => expect(connect).toHaveBeenCalled());
    expect(result.controlling()).toBe(control);
    expect(connect.mock.calls.at(-1)?.[2]).toBe(control);
  }
);
