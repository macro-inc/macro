import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForYouRouteView } from './route-views';

const mocks = vi.hoisted(() => ({
  flag: () => ({ enabled: false, loading: false }),
  source: vi.fn(() => ({})),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => mocks.flag(),
}));
vi.mock('@app/lib/i18n', () => ({ t: (key: string) => key }));
vi.mock('@core/constant/featureFlags', () => ({ enableForYou: {} }));
vi.mock('@core/context/user', () => ({
  useUserContext: () => ({ userId: () => 'test-user' }),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/component/LoadingBlock', () => ({
  LoadingBlock: () => <div>Loading flag</div>,
}));
vi.mock('@components/app/split-layout/split-router/app-route-shell', () => ({
  withAuth: (component: () => JSX.Element) => component,
  usePageViewTracking: vi.fn(),
  RedirectSplit: () => <div>Return home</div>,
}));
vi.mock('@app/components/view-shell', () => {
  const Frame = (props: { children?: JSX.Element }) => props.children;
  return {
    ViewShell: { Root: Frame, Main: Frame, TopBar: Frame },
    ViewSidebar: { Title: Frame },
  };
});
vi.mock('./actions', () => ({ feedActions: {} }));
vi.mock('./queries/feed-source', () => ({
  createFeedSource: () => mocks.source(),
}));
vi.mock('./queries/preferences', () => ({
  createFeedPreferences: () => ({ prompt: () => '' }),
}));
vi.mock('./views/for-you-view', () => ({
  ForYouView: () => <div>Live feed</div>,
}));

afterEach(() => {
  cleanup();
  mocks.source.mockClear();
});

describe('For you rollout', () => {
  it('waits for the flag, mounts generation only when enabled, and leaves when disabled', () => {
    const [flag, setFlag] = createSignal({ enabled: false, loading: true });
    mocks.flag = flag;
    render(() => <ForYouRouteView />);
    expect(screen.getByText('Loading flag')).toBeTruthy();
    expect(screen.queryByText('Return home')).toBeNull();
    expect(mocks.source).not.toHaveBeenCalled();

    setFlag({ enabled: true, loading: false });
    expect(screen.getByText('Live feed')).toBeTruthy();
    expect(mocks.source).toHaveBeenCalledOnce();

    setFlag({ enabled: false, loading: false });
    expect(screen.queryByText('Live feed')).toBeNull();
    expect(screen.getByText('Return home')).toBeTruthy();
  });

  it('does not construct a feed for a disabled deep link', () => {
    mocks.flag = () => ({ enabled: false, loading: false });
    render(() => <ForYouRouteView />);
    expect(screen.getByText('Return home')).toBeTruthy();
    expect(mocks.source).not.toHaveBeenCalled();
  });
});
