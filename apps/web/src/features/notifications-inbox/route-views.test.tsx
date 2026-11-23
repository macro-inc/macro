import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsRouteView } from './route-views';

const state = vi.hoisted(() => ({
  notifications: (): boolean => false,
  newHome: (): 'off' | 'both' | 'new-only' | undefined => 'off',
  flagsLoaded: (): boolean => true,
  replace: vi.fn(),
  pageView: vi.fn(),
}));

vi.mock('@core/auth', () => ({ useIsAuthenticated: () => () => true }));
vi.mock('@core/component/LoadingBlock', () => ({ LoadingBlock: () => null }));
vi.mock('@core/constant/featureFlags', () => ({
  enableUnifiedNotifications: { key: 'enable-unified-notifications' },
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  usePosthog: () => ({ flagsLoaded: () => state.flagsLoaded() }),
  useFeatureFlag: () => () => ({
    enabled: state.notifications(),
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
vi.mock('../new-home/use-new-home-mode', () => ({
  useNewHomeMode: () => () => state.newHome(),
}));
vi.mock('../new-home/new-home-notifications', () => ({
  NewHomeNotificationsView: () => <div>New Home’s Notifications tab</div>,
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
  state.newHome = () => 'off';
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

  it('opens the inbox when the rollout is on', async () => {
    state.notifications = () => true;
    renderRoute();

    expect(await screen.findByText('The inbox')).toBeTruthy();
    expect(state.replace).not.toHaveBeenCalled();
    expect(state.pageView).toHaveBeenCalledExactlyOnceWith('notifications');
  });

  it.each(['both', 'new-only'] as const)(
    'opens New Home’s Notifications tab with New Home on (%s)',
    async (mode) => {
      state.newHome = () => mode;
      renderRoute();

      expect(
        await screen.findByText('New Home’s Notifications tab')
      ).toBeTruthy();
      expect(screen.queryByText('The inbox')).toBeNull();
      expect(state.replace).not.toHaveBeenCalled();
      expect(state.pageView).toHaveBeenCalledExactlyOnceWith(
        'new-home-notifications'
      );
    }
  );

  it('waits for New Home’s flags before choosing the inbox', async () => {
    const [newHome, setNewHome] = createSignal<'off' | 'both' | undefined>();
    state.notifications = () => true;
    state.newHome = newHome;
    renderRoute();

    expect(screen.queryByText('The inbox')).toBeNull();
    expect(screen.queryByText('New Home’s Notifications tab')).toBeNull();

    setNewHome('both');
    expect(
      await screen.findByText('New Home’s Notifications tab')
    ).toBeTruthy();
    expect(screen.queryByText('The inbox')).toBeNull();
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
