import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsRouteView } from './route-views';

const state = vi.hoisted(() => ({
  notifications: (): boolean => false,
  graphql: (): boolean => true,
  flagsLoaded: (): boolean => true,
  replace: vi.fn(),
  pageView: vi.fn(),
}));

vi.mock('@core/auth', () => ({ useIsAuthenticated: () => () => true }));
vi.mock('@core/component/LoadingBlock', () => ({ LoadingBlock: () => null }));
vi.mock('@core/constant/featureFlags', () => ({
  enableUnifiedNotifications: { key: 'enable-unified-notifications' },
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  usePosthog: () => ({ flagsLoaded: () => state.flagsLoaded() }),
  useFeatureFlag: (flag: { key: string }) => () => ({
    enabled:
      flag.key === 'enable-graphql-soup'
        ? state.graphql()
        : state.notifications(),
    loading: !state.flagsLoaded(),
  }),
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ pageView: state.pageView, track: vi.fn() }),
}));
vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/split-router')>()),
  useSplitRouter: () => ({ entry: () => undefined }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ handle: { replace: state.replace } }),
}));
vi.mock('./notifications-inbox', () => ({
  NotificationsInbox: () => <div>The inbox</div>,
}));
vi.mock('./views/notifications-calendar-pane', () => ({
  NotificationsCalendarPane: () => null,
}));

const home = {
  next: { type: 'component', id: 'home', entryMetadata: { search: {} } },
};

const renderRoute = () =>
  render(() => (
    <Suspense>
      <NotificationsRouteView />
    </Suspense>
  ));

beforeEach(() => {
  vi.clearAllMocks();
  state.notifications = () => false;
  state.graphql = () => true;
  state.flagsLoaded = () => true;
});

afterEach(cleanup);

describe('NotificationsRouteView', () => {
  it('sends the split to Home when the rollout is off', () => {
    renderRoute();

    expect(state.replace).toHaveBeenCalledExactlyOnceWith(home);
    expect(screen.queryByText('The inbox')).toBeNull();
    expect(state.pageView).not.toHaveBeenCalled();
  });

  it('needs the GraphQL transport as well as the rollout', () => {
    state.notifications = () => true;
    state.graphql = () => false;
    renderRoute();

    expect(state.replace).toHaveBeenCalledExactlyOnceWith(home);
    expect(screen.queryByText('The inbox')).toBeNull();
  });

  it('opens the inbox when the rollout is on', async () => {
    state.notifications = () => true;
    renderRoute();

    expect(await screen.findByText('The inbox')).toBeTruthy();
    expect(state.replace).not.toHaveBeenCalled();
    expect(state.pageView).toHaveBeenCalledExactlyOnceWith('notifications');
  });

  it.each([false, true])(
    'does not leave before flags answer (rollout on: %s)',
    async (enabled) => {
      const [notifications, setNotifications] = createSignal(false);
      const [flagsLoaded, setFlagsLoaded] = createSignal(false);
      state.notifications = notifications;
      state.flagsLoaded = flagsLoaded;
      renderRoute();

      expect(state.replace).not.toHaveBeenCalled();
      expect(screen.queryByText('The inbox')).toBeNull();

      setNotifications(enabled);
      setFlagsLoaded(true);

      if (enabled) {
        expect(await screen.findByText('The inbox')).toBeTruthy();
        expect(state.replace).not.toHaveBeenCalled();
      } else {
        expect(state.replace).toHaveBeenCalledExactlyOnceWith(home);
      }
    }
  );
});
