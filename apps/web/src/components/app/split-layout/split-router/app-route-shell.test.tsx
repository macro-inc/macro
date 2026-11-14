import { consumePostLoginRedirect } from '@core/util/postLoginRedirect';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const [authenticated, setAuthenticated] = createSignal<boolean | undefined>();
const navigate = vi.fn();
const mountView = vi.fn();
const mountPending = vi.fn();

vi.mock('@core/auth', () => ({ useIsAuthenticated: () => authenticated }));
vi.mock('@solidjs/router', () => ({ useNavigate: () => navigate }));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ pageView: vi.fn(), track: vi.fn() }),
}));
vi.mock('@app/lib/split-router', () => ({
  isRecord: () => false,
  useSplitRouter: () => ({}),
}));
vi.mock('../layoutUtils', () => ({ useSplitPanelOrThrow: () => ({}) }));

import { withAuth } from './app-route-shell';

const Gated = withAuth(
  () => {
    mountView();
    return <div />;
  },
  () => {
    mountPending();
    return <div />;
  }
);

const projectPath =
  '/app/component/initiative-view~01a16fdc-a7c4-7c62-b90e-61fe0e589298~overview';

beforeEach(() => {
  setAuthenticated(undefined);
  window.history.replaceState(null, '', `${projectPath}?referral_code=r1`);
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('sends a signed-out visitor from Login to login and back to the page', () => {
  setAuthenticated(false);
  render(() => <Gated />);

  expect(mountView).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Login' }));
  expect(navigate).toHaveBeenCalledWith('/login?referral_code=r1');
  expect(consumePostLoginRedirect()).toBe(
    `${window.location.origin}${projectPath}?referral_code=r1`
  );
});

it('sends a signed-out visitor from Sign Up to sign-up and back to the page', () => {
  setAuthenticated(false);
  render(() => <Gated />);

  fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }));
  expect(navigate).toHaveBeenCalledWith('/welcome?referral_code=r1');
  expect(consumePostLoginRedirect()).toBe(
    `${window.location.origin}${projectPath}?referral_code=r1`
  );
});

it('waits for identity before mounting the view or the sign-in actions', () => {
  render(() => <Gated />);

  expect(mountPending).toHaveBeenCalledOnce();
  expect(mountView).not.toHaveBeenCalled();
  setAuthenticated(false);
  fireEvent.click(screen.getByRole('button', { name: 'Login' }));
  expect(navigate).toHaveBeenCalledWith('/login?referral_code=r1');
  setAuthenticated(true);
  expect(mountView).toHaveBeenCalledOnce();
});
