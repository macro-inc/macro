import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  authenticated: false as boolean | undefined,
  native: false,
  track: vi.fn(),
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: state.track }),
}));

vi.mock('@app/constants/routerBase', () => ({ ROUTER_BASE_CONCAT: '/app/' }));
vi.mock('@core/context/user', () => ({
  useIsAuthenticated: () => () => state.authenticated,
}));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => state.native,
}));
vi.mock('@core/component/LoadingBlock', () => ({
  LoadingBlock: () => <div role="status">Checking account</div>,
}));
vi.mock('@app/features/setup/views/PublicOnboarding', () => ({
  PublicOnboarding: (props: {
    loginUrl: string;
    onFeaturesSelected: (features: string[]) => void;
  }) => (
    <>
      <a href={props.loginUrl}>Public onboarding</a>
      <button onClick={() => props.onFeaturesSelected(['Email', 'Docs'])}>
        Choose features
      </button>
    </>
  ),
}));
vi.mock('./Login', () => ({ Login: () => <div>Existing authentication</div> }));

import { SignupEntry } from './SignupEntry';

beforeEach(() => {
  vi.clearAllMocks();
  state.authenticated = false;
  state.native = false;
  window.history.replaceState(null, '', '/app/welcome');
});
afterEach(cleanup);

describe('web signup entry', () => {
  it('tracks final public onboarding choices through the app PostHog provider', () => {
    const view = render(() => <SignupEntry />);
    expect(state.track).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Choose features' }));
    expect(state.track).toHaveBeenCalledExactlyOnceWith(
      'onboarding_v4_features_selected',
      {
        features: ['Email', 'Docs'],
        feature_count: 2,
        source: 'public_onboarding',
      }
    );
  });
  it('starts anonymous visitors before OAuth and preserves their invitation/referral', () => {
    window.history.replaceState(
      null,
      '',
      '/app/welcome?next=%2Fteam-invite%3Finvite%3Dtest&referral_code=launch'
    );
    const view = render(() => <SignupEntry />);
    const link = view.getByRole('link', { name: 'Public onboarding' });
    const url = new URL(link.getAttribute('href') ?? '');
    expect(url.pathname).toBe('/app/login');
    expect(url.searchParams.get('next')).toBe('/team-invite?invite=test');
    expect(url.searchParams.get('referral_code')).toBe('launch');
    expect(view.queryByText('Existing authentication')).toBeNull();
  });

  it('waits for unknown auth and keeps authenticated accounts on their existing path', () => {
    state.authenticated = undefined;
    const pending = render(() => <SignupEntry />);
    expect(pending.getByRole('status')).toBeTruthy();
    expect(pending.queryByRole('link')).toBeNull();
    cleanup();
    state.authenticated = true;
    const signedIn = render(() => <SignupEntry />);
    expect(signedIn.getByText('Existing authentication')).toBeTruthy();
    expect(signedIn.queryByRole('link')).toBeNull();
  });

  it('lets Login handle session callbacks and explicit Google work handoffs', () => {
    state.authenticated = undefined;
    for (const search of ['?token=session-code', '?onboarding=google-work']) {
      window.history.replaceState(null, '', `/app/signup${search}`);
      const view = render(() => <SignupEntry />);
      expect(view.getByText('Existing authentication')).toBeTruthy();
      expect(view.queryByRole('status')).toBeNull();
      cleanup();
    }
  });

  it('preserves native authentication with Apple sign-in', () => {
    state.native = true;
    const view = render(() => <SignupEntry />);
    expect(view.getByText('Existing authentication')).toBeTruthy();
    expect(view.queryByRole('link')).toBeNull();
  });
});
