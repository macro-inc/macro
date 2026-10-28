import {
  CreateContextProvider,
  useCreateContext,
} from '@app/features/command/context/create-context';
import { crmTaskComposerContext } from '@app/features/crm/task-composer';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { type Accessor, createSignal, Suspense } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveComponent } from '../componentRegistry';

const state = vi.hoisted(() => ({
  authenticated: (): boolean => true,
  enabled: (): boolean => false,
  flagsLoaded: (): boolean => true,
  touch: (): boolean => false,
  replace: vi.fn(),
  pageView: vi.fn(),
  track: vi.fn(),
  mountActivity: vi.fn(),
  mountProjects: vi.fn(),
  saveTask: vi.fn(),
  isPopover: false,
  close: vi.fn(),
  split: undefined as { id: string } | undefined,
  managerPublished: true,
  unregister: [] as (() => void)[],
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
vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/split-router')>()),
  useSplitRouter: () => ({ entry: () => undefined }),
  createSearchParams: () => [{ scope: 'mine' }, vi.fn()],
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
vi.mock('@core/constant/featureFlags', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@core/constant/featureFlags')>();
  return {
    ...original,
    isFeatureEnabled: (flag: typeof original.enableCrmActivity) =>
      flag === original.enableCrmActivity
        ? state.enabled()
        : original.isFeatureEnabled(flag),
  };
});
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

vi.mock('@app/features/home/components/HomeEntityDetailRouteView', () => ({
  HomeEntityDetailRouteView: () => null,
}));

// Quarantine unrelated registered views and their module-load side effects.
// Route/preview codecs otherwise pull the full block-definition graph into this test.
vi.mock('@app/features/home/home-route', () => ({}));
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
vi.mock('@app/features/home/home-view', () => ({
  HomeDetailRouteView: () => null,
  HomeCalendarRouteView: () => null,
  HomePendingView: () => null,
}));
vi.mock('@app/features/next-soup/filters/filter-store', () => ({}));
vi.mock('@app/features/next-soup/filters/filter-store/query-store', () => ({}));
vi.mock('@app/features/next-soup/sidebar/soup-filter-presets', () => ({}));
vi.mock('@app/features/next-soup/soup-view/soup-view', () => ({}));
vi.mock('@app/features/next-soup/use-recent-view-flag', () => ({}));
vi.mock('@app/features/settings/Settings', () => ({
  SettingsPanelComponentWrapper: () => null,
}));
vi.mock('@app/features/settings/IntegrationsPage', () => ({}));
vi.mock('@app/features/tasks-view/tasks-view', () => ({}));
vi.mock('@app/features/tasks-view/components/TasksDetailView', () => ({
  TasksDetailRouteView: () => null,
}));
vi.mock('@app/signal/splitLayout', () => {
  const manager = { activeSplit: () => state.split };
  return {
    globalSplitManager: () => (state.managerPublished ? manager : undefined),
  };
});
vi.mock('@block-calendar/components/EventComposerSplit', () => ({}));
vi.mock('@block-channel/component/Compose', () => ({}));
vi.mock('@block-md/component/ComposeSkill', () => ({}));
vi.mock('@block-md/component/ComposeTask', () => ({
  ComposeTask: (props: {
    composerContext?: {
      key: string;
      initialPropertyValues?: Record<string, unknown>;
    };
    initialTitle?: string;
  }) => {
    const [title, setTitle] = createSignal(props.initialTitle ?? '');
    const [content, setContent] = createSignal('');
    return (
      <div>
        <div>
          {props.composerContext?.key ?? 'Standard'} composer:{' '}
          {props.initialTitle}
        </div>
        <input
          aria-label="Task title"
          value={title()}
          onInput={(event) => setTitle(event.currentTarget.value)}
        />
        <textarea
          aria-label="Task description"
          value={content()}
          onInput={(event) => setContent(event.currentTarget.value)}
        />
        <button
          type="button"
          onClick={() =>
            state.saveTask({
              title: title(),
              content: content(),
              properties: props.composerContext?.initialPropertyValues,
            })
          }
        >
          Save task
        </button>
      </div>
    );
  },
}));
vi.mock('@app/features/crm/queries/saved-views', () => ({}));
vi.mock('@core/context/user', () => ({}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => state.touch(),
}));
vi.mock('@app/features/routines/queries/entities', () => ({}));
vi.mock('@ui', () => ({
  createVariants: () => () => '',
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.isPopover = false;
  state.authenticated = () => true;
  state.enabled = () => false;
  state.flagsLoaded = () => true;
  state.touch = () => false;
  state.split = undefined;
  state.managerPublished = true;
});
afterEach(() => {
  cleanup();
  for (const unregister of state.unregister.splice(0)) unregister();
});

/** Registry views are lazy chunks; settle the chunk so assertions see the view. */
async function renderActivity() {
  const activity = resolveComponent('activity');
  const result = render(() => <Suspense>{activity.element()}</Suspense>);
  await import('@app/features/activity/route-views');
  await new Promise((resolve) => setTimeout(resolve, 0));
  return result;
}
describe('calendar layout registration', () => {
  it('owns desktop chrome but keeps the floating split header on touch', () => {
    expect(resolveComponent('calendar').initialMeta).toMatchObject({
      splitPanelLayout: 'composable',
    });
    state.touch = () => true;
    expect(resolveComponent('calendar').initialMeta).toBeUndefined();
  });
});

describe('activity registration', () => {
  it('redirects a disabled feed to inbox without mounting or tracking it', async () => {
    await renderActivity();

    expect(state.replace).toHaveBeenCalledExactlyOnceWith({
      next: { type: 'component', id: 'home', entryMetadata: { search: {} } },
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
      await renderActivity();

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
          next: {
            type: 'component',
            id: 'home',
            entryMetadata: { search: {} },
          },
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
    await renderActivity();

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

describe('contextual task composer registration', () => {
  it.each([false, true])(
    'opens immediately while flags load and keeps its opening mode (enabled after load: %s)',
    async (enabled) => {
      const [flagEnabled, setFlagEnabled] = createSignal(false);
      const [flagsLoaded, setFlagsLoaded] = createSignal(false);
      state.enabled = flagEnabled;
      state.flagsLoaded = flagsLoaded;
      const component = resolveComponent('task-compose', {
        initialTitle: 'Follow up',
        composerContext: { key: 'crm:company:acme', visiblePropertyIds: [] },
      });
      render(() => (
        <Suspense>
          <Dynamic component={component.element} />
        </Suspense>
      ));
      expect(
        await screen.findByText('crm:company:acme composer: Follow up')
      ).toBeTruthy();
      const title = screen.getByRole('textbox', { name: 'Task title' });
      fireEvent.input(title, { target: { value: 'Draft saved' } });

      setFlagEnabled(enabled);
      setFlagsLoaded(true);
      expect(
        screen.getByText('crm:company:acme composer: Follow up')
      ).toBeTruthy();
      expect(screen.getByRole('textbox', { name: 'Task title' })).toBe(title);
      expect(title).toHaveProperty('value', 'Draft saved');

      const next = resolveComponent('task-compose', {
        initialTitle: 'Next',
        composerContext: { key: 'crm:company:acme', visiblePropertyIds: [] },
      });
      render(() => (
        <Suspense>
          <Dynamic component={next.element} />
        </Suspense>
      ));
      expect(
        await screen.findByText('crm:company:acme composer: Next')
      ).toBeTruthy();
    }
  );

  it('opens standard tasks without waiting for the CRM rollout', async () => {
    state.flagsLoaded = () => false;
    const component = resolveComponent('task-compose', {
      initialTitle: 'Plan',
    });
    render(() => (
      <Suspense>
        <Dynamic component={component.element} />
      </Suspense>
    ));
    expect(await screen.findByText('Standard composer: Plan')).toBeTruthy();
  });

  it.each([true, false])(
    'preserves an open draft and its associations when the rollout changes (initial: %s)',
    async (initiallyEnabled) => {
      const [enabled, setEnabled] = createSignal(initiallyEnabled);
      state.enabled = enabled;
      const properties = {
        companies: {
          valueType: 'ENTITY',
          refs: [{ entity_id: 'acme', entity_type: 'COMPANY' }],
        },
      };
      const component = resolveComponent('task-compose', {
        composerContext: {
          key: 'CRM',
          visiblePropertyIds: ['companies'],
          initialPropertyValues: properties,
        },
      });
      render(() => (
        <Suspense>
          <Dynamic component={component.element} />
        </Suspense>
      ));
      const title = await screen.findByRole('textbox', { name: 'Task title' });
      const description = screen.getByRole('textbox', {
        name: 'Task description',
      });
      fireEvent.input(title, { target: { value: 'Follow up with Acme' } });
      fireEvent.input(description, {
        target: { value: 'Discuss the renewal' },
      });
      setEnabled(!initiallyEnabled);
      expect(screen.getByRole('textbox', { name: 'Task title' })).toBe(title);
      expect(screen.getByRole('textbox', { name: 'Task description' })).toBe(
        description
      );
      fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
      expect(state.saveTask).toHaveBeenCalledExactlyOnceWith({
        title: 'Follow up with Acme',
        content: 'Discuss the renewal',
        properties,
      });
      const next = resolveComponent('task-compose', {
        initialTitle: 'New draft',
        composerContext: { key: 'CRM', initialPropertyValues: properties },
      });
      render(() => (
        <Suspense>
          <Dynamic component={next.element} />
        </Suspense>
      ));
      expect(await screen.findByText('CRM composer: New draft')).toBeTruthy();
    }
  );

  it.each([true, false])(
    'uses supplied context when flags change before mounting (enabled at launch: %s)',
    async (initiallyEnabled) => {
      const [enabled, setEnabled] = createSignal(initiallyEnabled);
      state.enabled = enabled;
      const properties = {
        companies: {
          valueType: 'ENTITY',
          refs: [{ entity_id: 'acme', entity_type: 'COMPANY' }],
        },
      };
      const component = resolveComponent('task-compose', {
        initialTitle: 'Follow up',
        composerContext: { key: 'CRM', initialPropertyValues: properties },
      });
      setEnabled(!initiallyEnabled);
      render(() => (
        <Suspense>
          <Dynamic component={component.element} />
        </Suspense>
      ));
      await screen.findByRole('textbox', { name: 'Task title' });
      fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
      expect(state.saveTask).toHaveBeenCalledExactlyOnceWith({
        title: 'Follow up',
        content: '',
        properties,
      });
    }
  );
});

function mountCreateContext(focusedPaneId: Accessor<string | undefined>) {
  let context!: ReturnType<typeof useCreateContext>;
  render(() => (
    <CreateContextProvider focusedPaneId={focusedPaneId}>
      {(() => {
        context = useCreateContext();
        return null;
      })()}
    </CreateContextProvider>
  ));
  return context;
}

describe('pane create context registration', () => {
  it('reads the focused pane and supports explicit pane selection', () => {
    const [paneId, setPaneId] = createSignal<string | undefined>('one');
    const context = mountCreateContext(paneId);
    state.unregister.push(
      context.register('one', () => ({ task: { key: 'first' } })),
      context.register('two', () => ({ task: { key: 'second' } }))
    );
    expect(context.read('task')?.key).toBe('first');
    expect(context.snapshot('task')?.key).toBe('first');
    setPaneId('two');
    expect(context.read('task')?.key).toBe('second');
    expect(context.snapshot('task', 'one')?.key).toBe('first');
    expect(context.read('task', 'one')?.key).toBe('first');
    setPaneId(undefined);
    expect(context.read('task')).toBeUndefined();
    expect(context.snapshot('task')).toBeUndefined();
  });

  it('isolates providers with identical pane IDs', () => {
    const first = mountCreateContext(() => 'pane');
    const second = mountCreateContext(() => 'pane');
    state.unregister.push(
      first.register('pane', () => ({ task: { key: 'first' } })),
      second.register('pane', () => ({ task: { key: 'second' } }))
    );
    expect(first.snapshot('task')?.key).toBe('first');
    expect(second.snapshot('task')?.key).toBe('second');
  });

  it('works without a published global split manager', () => {
    state.managerPublished = false;
    const context = mountCreateContext(() => 'pane');
    state.unregister.push(
      context.register('pane', () => ({ task: { key: 'mounted' } }))
    );
    expect(context.snapshot('task')?.key).toBe('mounted');
  });

  it('restores the parent after nested cleanup and tolerates repeated teardown', () => {
    const context = mountCreateContext(() => 'pane');
    const removeParent = context.register('pane', () => ({
      task: { key: 'parent' },
    }));
    const removeChild = context.register('pane', () => ({
      task: { key: 'child' },
    }));
    state.unregister.push(removeParent, removeChild);
    expect(context.snapshot('task')?.key).toBe('child');
    removeChild();
    expect(context.snapshot('task')?.key).toBe('parent');
    removeChild();
    expect(context.snapshot('task')?.key).toBe('parent');
    removeParent();
    expect(context.snapshot('task')).toBeUndefined();
  });

  it('keeps the child when its parent unmounts first', () => {
    const context = mountCreateContext(() => 'pane');
    const removeParent = context.register('pane', () => ({
      task: { key: 'parent' },
    }));
    const removeChild = context.register('pane', () => ({
      task: { key: 'child' },
    }));
    state.unregister.push(removeParent, removeChild);
    removeParent();
    expect(context.snapshot('task')?.key).toBe('child');
    removeChild();
    expect(context.snapshot('task')).toBeUndefined();
  });

  it('reads loaded associations at launch and leaves an earlier snapshot unchanged', () => {
    const context = mountCreateContext(() => 'pane');
    const [companyId, setCompanyId] = createSignal<string>();
    state.unregister.push(
      context.register('pane', () => ({
        task: crmTaskComposerContext({
          type: 'contact',
          id: 'maya',
          companyId: companyId(),
        }),
      }))
    );
    const first = context.snapshot('task');
    expect(
      first?.initialPropertyValues?.[SYSTEM_PROPERTY_IDS.COMPANIES]
    ).toBeUndefined();
    setCompanyId('acme');
    const next = context.snapshot('task');
    expect(next?.initialPropertyValues?.[SYSTEM_PROPERTY_IDS.CONTACTS]).toEqual(
      {
        valueType: 'ENTITY',
        refs: [{ entity_id: 'maya', entity_type: 'CONTACT' }],
      }
    );
    expect(
      next?.initialPropertyValues?.[SYSTEM_PROPERTY_IDS.COMPANIES]
    ).toEqual({
      valueType: 'ENTITY',
      refs: [{ entity_id: 'acme', entity_type: 'COMPANY' }],
    });
    expect(
      first?.initialPropertyValues?.[SYSTEM_PROPERTY_IDS.COMPANIES]
    ).toBeUndefined();
  });

  it('isolates snapshots from mutable provider values', () => {
    const context = mountCreateContext(() => 'pane');
    const preset = crmTaskComposerContext({ type: 'company', id: 'acme' });
    state.unregister.push(context.register('pane', () => ({ task: preset })));
    const snapshot = context.snapshot('task');
    preset.visiblePropertyIds?.push('new-property');
    expect(snapshot?.visiblePropertyIds).not.toContain('new-property');
  });

  it('suppresses a parent with null and responds to reactive source changes', () => {
    const context = mountCreateContext(() => 'pane');
    const [enabled, setEnabled] = createSignal(false);
    state.unregister.push(
      context.register('pane', () => ({ task: { key: 'parent' } })),
      context.register('pane', () => ({
        task: enabled() ? { key: 'child' } : null,
      }))
    );
    expect(context.read('task')).toBeUndefined();
    expect(context.snapshot('task')).toBeUndefined();
    setEnabled(true);
    const snapshot = context.snapshot('task');
    expect(snapshot?.key).toBe('child');
    setEnabled(false);
    expect(context.read('task')).toBeUndefined();
    expect(snapshot?.key).toBe('child');
  });

  it('inherits the parent action when the child omits it', () => {
    const context = mountCreateContext(() => 'pane');
    state.unregister.push(
      context.register('pane', () => ({ task: { key: 'parent' } })),
      context.register('pane', () => ({}))
    );
    expect(context.read('task')?.key).toBe('parent');
    expect(context.snapshot('task')?.key).toBe('parent');
  });

  it('updates reads when registrations change', () => {
    const context = mountCreateContext(() => 'pane');
    const removeParent = context.register('pane', () => ({
      task: { key: 'parent' },
    }));
    state.unregister.push(removeParent);
    expect(context.read('task')?.key).toBe('parent');
    const removeChild = context.register('pane', () => ({
      task: { key: 'child' },
    }));
    state.unregister.push(removeChild);
    expect(context.read('task')?.key).toBe('child');
    removeChild();
    expect(context.read('task')?.key).toBe('parent');
    removeParent();
    expect(context.read('task')).toBeUndefined();
  });
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
