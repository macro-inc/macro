// @vitest-environment jsdom

import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: 'android',
  navigate: vi.fn(),
  setPostLoginRedirect: vi.fn(),
  listen: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@core/util/platform', () => ({
  getNativeMobilePlatform: () => mocks.platform,
}));
vi.mock('@core/util/postLoginRedirect', () => ({
  setPostLoginRedirect: mocks.setPostLoginRedirect,
}));
vi.mock('@solidjs/router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('./macroLinkInterceptor', () => ({
  registerMacroLinkInterceptor: () => () => {},
}));

import { registerPipedreamCallback } from '@core/pipedream/connect-callback';
import {
  pendingNotificationNavigationId,
  setPendingNotificationNavigationId,
} from '@notifications/notification-navigation-intent';
import { useTauriNavigationEffect } from './navigation';

let dispose: (() => void) | undefined;
let receive: (event: { payload: { path: string; query: string } }) => void;

beforeEach(() => {
  vi.clearAllMocks();
  setPendingNotificationNavigationId(undefined);
  mocks.platform = 'android';
  mocks.invoke.mockResolvedValue(undefined);
  mocks.listen.mockImplementation(async (_name, handler) => {
    receive = handler;
    return () => {};
  });
  createRoot((cleanup) => {
    dispose = cleanup;
    useTauriNavigationEffect();
  });
});

afterEach(() => dispose?.());

describe('native link session routing', () => {
  it('queues a desktop notification click for navigation when the layout is ready', () => {
    mocks.platform = 'macos';
    receive({
      payload: {
        path: '/notification',
        query:
          'notificationId=01a1561c-62b1-7ee4-99d5-1fa5988dbf5d&deliveryId=delivery',
      },
    });
    expect(pendingNotificationNavigationId()).toBe(
      '01a1561c-62b1-7ee4-99d5-1fa5988dbf5d'
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('uses the clicked notification rather than the most recently received one', () => {
    setPendingNotificationNavigationId('newer-notification');
    receive({
      payload: {
        path: '/notification',
        query: 'notificationId=older-notification',
      },
    });
    expect(pendingNotificationNavigationId()).toBe('older-notification');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it.each(['', 'notificationId='])(
    'ignores notification links without a target (%s)',
    (query) => {
      receive({ payload: { path: '/notification', query } });
      expect(pendingNotificationNavigationId()).toBeUndefined();
      expect(mocks.navigate).not.toHaveBeenCalled();
    }
  );

  it('completes a connector callback without navigating away from the active chat', () => {
    const onEvent = vi.fn();
    const { state } = registerPipedreamCallback(onEvent);
    receive({
      payload: {
        path: '/pipedream-connect-callback',
        query: `state=${state}&outcome=success&account_id=apn_test`,
      },
    });
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({
      type: 'success',
      accountId: 'apn_test',
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.setPostLoginRedirect).not.toHaveBeenCalled();
  });

  it('ignores stale connector callbacks without routing to a missing page', () => {
    receive({
      payload: {
        path: '/pipedream-connect-callback',
        query: 'state=expired&outcome=closed',
      },
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it('preserves query parameters on Android root links', () => {
    receive({
      payload: { path: '/', query: 'subscriptionSuccess=true&type=pro' },
    });

    expect(mocks.navigate).toHaveBeenCalledWith(
      '/?subscriptionSuccess=true&type=pro'
    );
    expect(mocks.setPostLoginRedirect).not.toHaveBeenCalled();
  });

  it('retains an Android destination and its query while checking the session', () => {
    receive({ payload: { path: '/task/123', query: 'view=comments' } });

    expect(mocks.setPostLoginRedirect).toHaveBeenCalledWith(
      '/task/123?view=comments'
    );
    expect(mocks.navigate).toHaveBeenCalledWith('/');
  });

  it('leaves direct login links and their queries intact', () => {
    receive({ payload: { path: '/login', query: 'referral_code=invite' } });

    expect(mocks.navigate).toHaveBeenCalledWith('/login?referral_code=invite');
    expect(mocks.setPostLoginRedirect).not.toHaveBeenCalled();
  });

  it('preserves direct routing on other native platforms', () => {
    mocks.platform = 'ios';
    receive({ payload: { path: '/task/123', query: 'view=comments' } });

    expect(mocks.navigate).toHaveBeenCalledWith('/task/123?view=comments');
    expect(mocks.setPostLoginRedirect).not.toHaveBeenCalled();
  });
});
