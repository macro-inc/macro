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

import { useTauriNavigationEffect } from './navigation';

let dispose: (() => void) | undefined;
let receive: (event: { payload: { path: string; query: string } }) => void;

beforeEach(() => {
  vi.clearAllMocks();
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
