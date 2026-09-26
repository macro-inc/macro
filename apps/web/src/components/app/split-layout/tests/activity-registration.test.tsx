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
  mountProjects: vi.fn(),
  isPopover: false,
  close: vi.fn(),
}));

vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('@core/auth', () => ({
  useIsAuthenticated: () => () => state.authenticated(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  usePosthog: () => ({ flagsLoaded: () => state.flagsLoaded() }),
  useFeatureFlag: () => () => ({
    enabled: state.enabled(),
    loading: !state.flagsLoaded(),
  }),
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ pageView: state.pageView, track: state.track }),
}));
vi.mock('../layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: {
      replace: state.replace,
      isPopover: () => state.isPopover,
      close: state.close,
    },
  }),
}));
vi.mock('@core/component/LoadingBlock', () => ({
  LoadingBlock: () => <div>Authenticating</div>,
}));
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: (type: string) => type,
  isBlockAlias: () => false,
  resolveBlockAlias: (type: string) => type,
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
vi.mock('@app/features/projects/project-view', () => ({
  ProjectsListView: () => {
    state.mountProjects();
    return <div>Project collection</div>;
  },
  ProjectView: () => {
    state.mountProjects();
    return <div>Project detail</div>;
  },
  CreateProjectView: () => {
    state.mountProjects();
    return <div>Project composer</div>;
  },
}));

vi.mock(
  '@app/features/inbox-view/components/InboxEntityDetailRouteView',
  () => ({ InboxEntityDetailRouteView: () => null })
);

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
  InboxCalendarRouteView: () => null,
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
vi.mock('@ui', () => ({
  createVariants: () => () => '',
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.authenticated = () => true;
  state.enabled = () => false;
  state.flagsLoaded = () => true;
  state.isPopover = false;
});

describe('project registration', () => {
  const routes = [
    ['tasks-projects', 'Project collection'],
    ['new-project', 'Project composer'],
    ['project-compose', 'Project composer'],
    [
      'initiative-view~01a0cf92-3101-7e21-9a20-6e21058d20e0~overview',
      'Project detail',
    ],
  ] as const;

  it.each(routes)(
    'gates a restored %s route until PostHog enables Projects',
    async (route, title) => {
      const [enabled, setEnabled] = createSignal(false);
      const [loaded, setLoaded] = createSignal(false);
      state.enabled = enabled;
      state.flagsLoaded = loaded;
      const component = resolveComponent(route);
      render(() => <Suspense>{component.element()}</Suspense>);
      expect(state.mountProjects).not.toHaveBeenCalled();
      expect(state.replace).not.toHaveBeenCalled();

      setEnabled(true);
      setLoaded(true);
      expect(await screen.findByText(title)).toBeTruthy();
      expect(state.replace).not.toHaveBeenCalled();

      setEnabled(false);
      expect(screen.queryByText(title)).toBeNull();
      expect(state.replace).toHaveBeenCalledExactlyOnceWith({
        next: { type: 'component', id: 'tasks' },
      });
    }
  );

  it.each(routes)(
    'redirects disabled %s without mounting project data',
    (route) => {
      const component = resolveComponent(route);
      render(() => <Suspense>{component.element()}</Suspense>);
      expect(state.mountProjects).not.toHaveBeenCalled();
      expect(state.replace).toHaveBeenCalledExactlyOnceWith({
        next: { type: 'component', id: 'tasks' },
      });
    }
  );

  it('closes a disabled composer popover instead of replacing its background split', () => {
    state.isPopover = true;
    const component = resolveComponent('project-compose');
    render(() => <Suspense>{component.element()}</Suspense>);
    expect(state.mountProjects).not.toHaveBeenCalled();
    expect(state.replace).not.toHaveBeenCalled();
    expect(state.close).toHaveBeenCalledOnce();
  });
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
