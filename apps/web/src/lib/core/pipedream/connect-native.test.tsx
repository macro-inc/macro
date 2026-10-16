import { fireEvent, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPipedreamCallbacks,
  handlePipedreamCallback,
  PIPEDREAM_CALLBACK_PATH,
} from './connect-callback';
import { openNativePipedreamConnectUI } from './connect-native';

const mocks = vi.hoisted(() => ({
  open: vi.fn(async (_command: string, _args: { url: string }) => {}),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.open }));
vi.mock('@core/util/webOrigin', () => ({
  getWebOrigin: () => 'https://dev.macro.com',
}));

beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()));

afterEach(() => {
  clearPipedreamCallbacks();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('native browser connection dialog', () => {
  it('opens the browser without a native iframe and allows cancellation and retry', () => {
    const onEvent = vi.fn();
    openNativePipedreamConnectUI({ token: 'fixture', app: 'linear', onEvent });
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(mocks.open.mock.calls[0][0]).toBe('plugin:opener|open_url');
    const url = new URL(mocks.open.mock.calls[0][1].url);
    expect(url.origin + url.pathname).toBe(
      'https://dev.macro.com/app/pipedream-connect.html'
    );
    expect(url.search).toBe('');
    const params = new URLSearchParams(url.hash.slice(1));
    expect(params.get('token')).toBe('fixture');
    fireEvent.click(screen.getByRole('button', { name: 'Open browser again' }));
    expect(mocks.open).toHaveBeenLastCalledWith('plugin:opener|open_url', {
      url: url.href,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    handlePipedreamCallback(
      PIPEDREAM_CALLBACK_PATH,
      `state=${params.get('state')}&outcome=success&account_id=apn_test`
    );
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({ type: 'close' });
    openNativePipedreamConnectUI({ token: 'retry', app: 'linear', onEvent });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('closes the dialog when consent returns and releases the callback', () => {
    const onEvent = vi.fn();
    openNativePipedreamConnectUI({ token: 'fixture', app: 'linear', onEvent });
    const state = new URLSearchParams(
      new URL(mocks.open.mock.calls[0][1].url).hash.slice(1)
    ).get('state');
    const query = `state=${state}&outcome=success&account_id=apn_test`;
    handlePipedreamCallback(PIPEDREAM_CALLBACK_PATH, query);
    handlePipedreamCallback(PIPEDREAM_CALLBACK_PATH, query);
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({
      type: 'success',
      accountId: 'apn_test',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('releases an abandoned attempt after ten minutes', () => {
    vi.useFakeTimers();
    const onEvent = vi.fn();
    openNativePipedreamConnectUI({ token: 'fixture', app: 'linear', onEvent });
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({ type: 'close' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
