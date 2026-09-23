import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveComponent } from '../componentRegistry';

const state = vi.hoisted(() => ({
  authenticated: (): boolean => true,
  enabled: (): boolean => false,
  flagsLoaded: (): boolean => true,
  replace: vi.fn(),
  pageView: vi.fn(),
  track: vi.fn(),
  mountActivity: vi.fn(),
}));

vi.mock('@core/auth', () => ({
  useIsAuthenticated: () => () => state.authenticated(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  usePosthog: () => ({ flagsLoaded: () => state.flagsLoaded() }),
  useFeatureFlag: () => () => ({ enabled: state.enabled() }),
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ pageView: state.pageView, track: state.track }),
}));
vi.mock('../layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ handle: { replace: state.replace } }),
}));
vi.mock('@core/component/LoadingBlock', () => ({
  LoadingBlock: () => <div>Authenticating</div>,
}));
vi.mock('@app/features/activity/views/my-activity-view', () => ({
  MyActivityView: () => {
    state.mountActivity();
    return <div>Activity feed</div>;
  },
}));
vi.mock('@app/features/activity/open-entity-in-split', () => ({
  openEntityInSplit: vi.fn(),
}));

// Quarantine unrelated registered views and their module-load side effects.
// Route/preview codecs otherwise pull the full block-definition graph into this test.
vi.mock('@app/features/inbox-view/inbox-route', () => ({}));
vi.mock('@app/features/agents-view/views/AgentsView', () => ({}));
vi.mock('@app/features/channels-view/channels-view', () => ({
  ChannelDetailRouteView: () => null,
}));
vi.mock('@app/features/drive-view/drive-view', () => ({}));
vi.mock('@app/features/drive-view/components/DriveDetailView', () => ({
  DriveDetailView: () => null,
}));
vi.mock('@app/features/email-compose/email-compose', () => ({}));
vi.mock('@app/features/email-view/email-view', () => ({}));
vi.mock('@app/features/email-view/components/EmailDetailView', () => ({
  EmailDetailRouteView: () => null,
}));
vi.mock('@app/features/getting-started', () => ({}));
vi.mock('@app/features/home', () => ({}));
vi.mock('@app/features/inbox-view/inbox-view', () => ({
  InboxDetailRouteView: () => null,
}));
vi.mock('@app/features/next-soup/filters/filter-store', () => ({}));
vi.mock('@app/features/next-soup/filters/filter-store/query-store', () => ({}));
vi.mock('@app/features/next-soup/sidebar/soup-filter-presets', () => ({}));
vi.mock('@app/features/next-soup/soup-view/soup-view', () => ({}));
vi.mock('@app/features/next-soup/use-recent-view-flag', () => ({}));
vi.mock('@app/features/reminders/ReminderEditorSplit', () => ({}));
vi.mock('@app/features/settings/Settings', () => ({
  SettingsPanelComponentWrapper: () => null,
}));
vi.mock('@app/features/settings/McpConnections', () => ({}));
vi.mock('@app/features/tasks-view/tasks-view', () => ({}));
vi.mock('@app/features/tasks-view/components/TasksDetailView', () => ({
  TasksDetailRouteView: () => null,
}));
vi.mock('@app/signal/splitLayout', () => ({}));
vi.mock('@block-calendar/components/EventComposerSplit', () => ({}));
vi.mock('@block-channel/component/Compose', () => ({}));
vi.mock('@block-md/component/ComposeSkill', () => ({}));
vi.mock('@block-md/component/ComposeTask', () => ({}));
vi.mock('@companies/crm/saved-views', () => ({}));
vi.mock('@core/context/user', () => ({}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => false,
}));
vi.mock('@queries/agent-schedule/entities', () => ({}));
vi.mock('@ui', () => ({}));

beforeEach(() => {
  vi.clearAllMocks();
  state.authenticated = () => true;
  state.enabled = () => false;
  state.flagsLoaded = () => true;
});
afterEach(cleanup);

function renderActivity() {
  const activity = resolveComponent('activity');
  return render(() => <Suspense>{activity.element()}</Suspense>);
}

describe('activity registration', () => {
  it('redirects a disabled feed to inbox without mounting or tracking it', () => {
    renderActivity();

    expect(state.replace).toHaveBeenCalledExactlyOnceWith({
      next: { type: 'component', id: 'inbox' },
    });
    expect(state.mountActivity).not.toHaveBeenCalled();
    expect(state.pageView).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'waits for flags before resolving a restored split (enabled: %s)',
    async (enabled) => {
      const [flagEnabled, setFlagEnabled] = createSignal(false);
      const [flagsLoaded, setFlagsLoaded] = createSignal(false);
      state.enabled = flagEnabled;
      state.flagsLoaded = flagsLoaded;
      renderActivity();

      expect(state.replace).not.toHaveBeenCalled();
      expect(state.mountActivity).not.toHaveBeenCalled();
      expect(state.pageView).not.toHaveBeenCalled();

      setFlagEnabled(enabled);
      setFlagsLoaded(true);

      if (enabled) {
        expect(await screen.findByText('Activity feed')).toBeTruthy();
        expect(state.replace).not.toHaveBeenCalled();
        expect(state.pageView).toHaveBeenCalledExactlyOnceWith('activity');
      } else {
        expect(state.replace).toHaveBeenCalledExactlyOnceWith({
          next: { type: 'component', id: 'inbox' },
        });
        expect(state.mountActivity).not.toHaveBeenCalled();
        expect(state.pageView).not.toHaveBeenCalled();
      }
    }
  );

  it('keeps an enabled feed behind authentication', async () => {
    const [authenticated, setAuthenticated] = createSignal(false);
    state.authenticated = authenticated;
    state.enabled = () => true;
    renderActivity();

    expect(screen.getByText('Authenticating')).toBeTruthy();
    expect(state.mountActivity).not.toHaveBeenCalled();
    expect(state.pageView).not.toHaveBeenCalled();
    expect(state.replace).not.toHaveBeenCalled();

    setAuthenticated(true);

    expect(await screen.findByText('Activity feed')).toBeTruthy();
    expect(state.mountActivity).toHaveBeenCalledOnce();
    expect(state.pageView).toHaveBeenCalledExactlyOnceWith('activity');
    expect(state.replace).not.toHaveBeenCalled();
  });
});
