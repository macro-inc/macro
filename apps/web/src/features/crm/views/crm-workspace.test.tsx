import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { createSignal, For, type JSX, type ParentProps, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createSettingsPage } from '../primitives/settings-page';
import { CrmWorkspaceView } from './crm-workspace';

const fixture = vi.hoisted(() => ({
  workspace: undefined as unknown,
  pipelinesEnabled: true,
  listsEnabled: true,
  touch: true,
  narrow: false,
  openWithSplit: vi.fn(),
  activityFlag: () => ({ enabled: true, loading: false }),
  setCollapsed: vi.fn(),
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => fixture.activityFlag(),
}));
vi.mock('@app/components/view-shell', () => ({
  ViewShell: {
    Root: (props: ParentProps) => props.children,
    Aside: (props: ParentProps) => props.children,
    Main: (props: ParentProps) => props.children,
    Header: (props: ParentProps) => <header>{props.children}</header>,
  },
  useViewShell: () => ({
    aside: { isCollapsed: () => true },
    breakpoints: { narrow: () => fixture.narrow },
  }),
  useViewControlHotkeys: () => {},
  SearchBar: () => null,
}));
vi.mock('@app/preferences/use-preference', () => ({
  usePreference: () => {
    const [collapsed, setCollapsed] = createSignal(false);
    return [
      collapsed,
      (value: boolean) => {
        fixture.setCollapsed(value);
        setCollapsed(value);
      },
    ];
  },
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => fixture.touch,
}));
vi.mock('@core/mobile/haptics', () => ({ hapticImpact: vi.fn() }));
vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));
vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ width: 0, height: 40 }),
}));
vi.mock('@entity', () => ({
  isCrmCompanyEntity: () => false,
  isCrmContactEntity: () => false,
}));
vi.mock('@ui', async () => ({
  ...(await import('../../../components/ui/utils/classname')),
  Layer: (props: ParentProps) => props.children,
  Tooltip: (props: ParentProps) => props.children,
  Button: (
    props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label?: string }
  ) => <button aria-label={props.label} {...props} />,
  Dropdown: Object.assign(
    (
      props: ParentProps<{
        open: boolean;
        onOpenChange: (open: boolean) => void;
      }>
    ) => (
      <div>
        <button type="button" onClick={() => props.onOpenChange(true)}>
          Show CRM navigation
        </button>
        <Show when={props.open}>{props.children}</Show>
      </div>
    ),
    { Trigger: () => null, Content: (props: ParentProps) => props.children }
  ),
}));
vi.mock('@components/app/split-panel', () => ({
  SplitPanel: {
    ControlGroup: (props: ParentProps) => <div>{props.children}</div>,
    CloseButton: () => <button type="button" aria-label="Close split" />,
  },
}));
vi.mock('@ui/components/Tour', () => ({ tourTarget: () => () => {} }));
vi.mock('@app/components/view-shell/tour', () => ({
  VIEW_SHELL_TOUR: { sidebarToggle: 'sidebar-toggle' },
}));
vi.mock('@app/features/next-soup/sidebar/soup-filter-presets', () => ({
  getViewPreset: () => ({ filters: {}, clientFilters: {} }),
}));
vi.mock(
  '@app/features/next-soup/soup-view/filters-bar/soup-active-filters-bar',
  () => ({
    SoupActiveFiltersBar: () => null,
  })
);
vi.mock(
  '@app/features/next-soup/soup-view/filters-bar/mobile-filter-drawer',
  () => ({
    MobileFilterDrawer: () => null,
  })
);
vi.mock(
  '@app/features/next-soup/soup-view/filters-bar/soup-filters-bar',
  () => ({
    SoupFiltersBar: () => null,
  })
);
vi.mock(
  '@app/features/next-soup/soup-view/filters-bar/soup-view-context-group',
  () => ({
    SoupViewContextGroup: () => null,
  })
);
vi.mock(
  '@app/features/next-soup/soup-view/filters-bar/soup-view-context-sort',
  () => ({
    SoupViewContextSort: () => null,
  })
);
vi.mock(
  '@app/features/next-soup/soup-view/filters-bar/unified-filter-dropdown',
  () => ({
    UnifiedFilterDropdown: () => null,
  })
);
vi.mock(
  '@app/features/next-soup/soup-view/filters-bar/use-filter-refinements',
  () => ({
    useFilterRefinements: () => ({ consolidatedFiltersList: () => [] }),
  })
);
vi.mock('../components/company-list-dialog', () => ({
  CrmListDialog: () => null,
}));
vi.mock('../components/crm-sidebar', () => ({
  CrmSidebar: (props: {
    pipelines?: JSX.Element;
    onNavigate: (id: string) => void;
    onSettings: () => void;
    onCollapse?: () => void;
  }) => (
    <nav aria-label="CRM sidebar">
      <Show when={props.onCollapse}>
        <button type="button" onClick={props.onCollapse}>
          Collapse CRM sidebar
        </button>
      </Show>
      <button type="button" onClick={() => props.onNavigate('active')}>
        Companies
      </button>
      <button type="button" onClick={() => props.onNavigate('people')}>
        People
      </button>
      {props.pipelines}
      <button type="button" onClick={props.onSettings}>
        CRM settings
      </button>
    </nav>
  ),
}));
vi.mock('../components/pipeline-sidebar', () => ({
  PipelineSidebar: (props: {
    pipelines: { id: string; name: string }[];
    onSelect: (id: string) => void;
  }) => (
    <For each={props.pipelines}>
      {(pipeline) => (
        <button type="button" onClick={() => props.onSelect(pipeline.id)}>
          {pipeline.name}
        </button>
      )}
    </For>
  ),
}));
vi.mock('../components/pipeline-dialog', () => ({
  PipelineDialog: () => null,
}));
vi.mock('./activity', () => ({
  CrmActivityView: (props: { tab: string }) => <div>{props.tab} feed</div>,
}));
vi.mock('./record-detail', () => ({
  CrmRecordDetail: (props: {
    viewName: string;
    records: { type: string; id: string }[];
  }) => (
    <div>
      {props.viewName} record{' '}
      {props.records.map((record) => `${record.type}:${record.id}`).join(' ')}
    </div>
  ),
}));
vi.mock('./crm-settings', () => ({ Crm: () => <div>Stage settings</div> }));
vi.mock('./export-companies', () => ({ CrmExport: () => null }));
vi.mock('./import-companies', () => ({ CrmImport: () => null }));
vi.mock('./pipeline', () => ({
  PipelineView: (props: {
    pipeline: { name: string };
    navigation?: JSX.Element;
    onOpenRecord(record: { type: 'company'; id: string }): void;
  }) => (
    <div>
      <header>{props.navigation}</header>
      {props.pipeline.name} table
      <button
        type="button"
        onClick={() => props.onOpenRecord({ type: 'company', id: 'acme' })}
      >
        Open Acme
      </button>
    </div>
  ),
}));
vi.mock('./saved-views-menu', () => ({
  CompanyDisplayMenu: () => null,
  CompanyViewsMenu: () => null,
}));
vi.mock('../context/workspace-context', () => ({
  useCrmWorkspace: () => fixture.workspace,
}));
vi.mock('../context/crm-context', () => ({
  useCrmContext: () => ({
    pipelinesEnabled: () => () => fixture.pipelinesEnabled,
    listsEnabled: () => () => fixture.listsEnabled,
    createNavigation: () => ({ openWithSplit: fixture.openWithSplit }),
    createPipelines: () => ({
      pipelines: () => [{ id: 'sales', name: 'Sales' }],
      loading: () => false,
      error: () => false,
    }),
  }),
}));
vi.mock('./use-crm', () => ({
  useCurrentTeamQuery: () => ({
    isSuccess: true,
    data: { team: { id: 'team', crm_enabled: true } },
  }),
  useCrmLists: () => ({
    lists: () => [
      {
        id: 'favorites',
        name: 'Favorites',
        config: { companyIds: ['company'] },
      },
    ],
    query: { isLoading: false, isError: false },
  }),
}));
vi.mock('./apply-view', () => ({
  useApplyCrmView: () => (config: { activeTab: string }) => {
    const workspace = fixture.workspace as {
      setActiveTab(value: string): void;
    };
    workspace.setActiveTab(config.activeTab);
  },
}));

afterEach(() => {
  cleanup();
  fixture.pipelinesEnabled = true;
  fixture.listsEnabled = true;
  fixture.touch = true;
  fixture.narrow = false;
  fixture.openWithSplit.mockReset();
  fixture.setCollapsed.mockReset();
});

/** A workspace whose route shows another tab's list when the tab changes. */
function setup(
  initialTab = 'active',
  initialActivityFlag = { enabled: true, loading: false }
) {
  const [activityFlag, setActivityFlag] = createSignal(initialActivityFlag);
  fixture.activityFlag = activityFlag;
  const [activeTab, setTab] = createSignal<string | undefined>(initialTab);
  const [records, setRecords] = createSignal<
    readonly { type: 'company' | 'contact'; id: string; name: string }[]
  >([]);
  const record = {
    records,
    section: () => undefined,
    commentTarget: () => undefined,
    open: vi.fn(setRecords),
    setSection: vi.fn(),
    close: vi.fn(() => setRecords([])),
  };
  const setActiveTab = (tab: string) => {
    setRecords([]);
    setTab(tab);
  };
  const captureEntryState = vi.fn();
  const settings = createSettingsPage(() =>
    [activeTab(), ...records().map((record) => record.id)].join(' ')
  );
  fixture.workspace = {
    activeTab,
    setActiveTab,
    host: {
      scopeId: 'crm',
      isActive: () => true,
      captureEntryState,
      settings,
      record,
    },
    source: {},
    queryFilters: { state: { include: {} }, replace: vi.fn() },
    searchText: () => '',
    setSearchText: vi.fn(),
  };
  render(() => (
    <CrmWorkspaceView>{() => <div>Record list</div>}</CrmWorkspaceView>
  ));
  return { activeTab, record, captureEntryState, setActivityFlag };
}

it('keeps sidebar destinations in the mobile header when switching records, pipelines and lists', () => {
  const { activeTab } = setup();
  const tabs = () =>
    within(screen.getByRole('navigation', { name: 'CRM views' }));
  expect(
    screen.queryByRole('button', { name: 'Expand CRM sidebar' })
  ).toBeNull();
  expect(
    tabs().getByRole('button', { name: 'Companies', pressed: true })
  ).toBeTruthy();
  fireEvent.click(tabs().getByRole('button', { name: 'People' }));
  expect(activeTab()).toBe('people');
  expect(
    tabs().getByRole('button', { name: 'People', pressed: true })
  ).toBeTruthy();
  fireEvent.click(tabs().getByRole('button', { name: 'Sales' }));
  expect(activeTab()).toBe('pipeline:sales');
  expect(screen.getByText('Sales table')).toBeTruthy();
  expect(
    tabs().getByRole('button', { name: 'Sales', pressed: true })
  ).toBeTruthy();
  fireEvent.click(tabs().getByRole('button', { name: 'Favorites' }));
  expect(activeTab()).toBe('list:favorites');
  expect(
    tabs().getByRole('button', { name: 'Favorites', pressed: true })
  ).toBeTruthy();
});

it('omits pipelines and lists when those features are disabled', () => {
  fixture.pipelinesEnabled = false;
  fixture.listsEnabled = false;
  setup();
  const tabs = within(screen.getByRole('navigation', { name: 'CRM views' }));
  expect(
    tabs.getAllByRole('button').map((button) => button.textContent)
  ).toEqual(['Companies', 'People', 'Tasks', 'Email', 'Notes', 'Calls']);
});

it('opens each CRM activity feed instead of the company list', () => {
  const { activeTab } = setup();
  const tabs = within(screen.getByRole('navigation', { name: 'CRM views' }));
  for (const label of ['Tasks', 'Email', 'Notes', 'Calls']) {
    fireEvent.click(tabs.getByRole('button', { name: label }));
    expect(activeTab()).toBe(label.toLowerCase());
    expect(screen.getByText(`${label.toLowerCase()} feed`)).toBeTruthy();
    expect(screen.queryByText('Record list')).toBeNull();
  }
  fireEvent.click(tabs.getByRole('button', { name: 'Companies' }));
  expect(screen.getByText('Record list')).toBeTruthy();
});

it('waits for the rollout before resolving a cold activity link', () => {
  const { activeTab, setActivityFlag } = setup('tasks', {
    enabled: false,
    loading: true,
  });
  expect(activeTab()).toBe('tasks');
  expect(screen.getByText('Loading CRM activity…')).toBeTruthy();
  expect(screen.queryByText('tasks feed')).toBeNull();
  expect(screen.queryByText('Record list')).toBeNull();
  setActivityFlag({ enabled: true, loading: false });
  expect(activeTab()).toBe('tasks');
  expect(screen.getByText('tasks feed')).toBeTruthy();
});

it('hides activity navigation and leaves its feed when the rollout turns off', () => {
  const { activeTab, setActivityFlag } = setup('email');
  expect(screen.getByText('email feed')).toBeTruthy();
  setActivityFlag({ enabled: false, loading: false });
  expect(activeTab()).toBe('active');
  expect(screen.queryByText('email feed')).toBeNull();
  expect(screen.getByText('Record list')).toBeTruthy();
  const tabs = within(screen.getByRole('navigation', { name: 'CRM views' }));
  for (const name of ['Tasks', 'Email', 'Notes', 'Calls']) {
    expect(tabs.queryByRole('button', { name })).toBeNull();
  }
});

it.each(['tasks', 'email', 'notes', 'calls'])(
  'returns an unavailable %s deep link to Companies without mounting activity',
  (tab) => {
    const { activeTab } = setup(tab, { enabled: false, loading: false });
    expect(activeTab()).toBe('active');
    expect(screen.queryByText(`${tab} feed`)).toBeNull();
    expect(screen.getByText('Record list')).toBeTruthy();
  }
);

it('opens the company of a pipeline row through the route on desktop', () => {
  fixture.touch = false;
  const { record, captureEntryState } = setup('pipeline:sales');
  fireEvent.click(screen.getByRole('button', { name: 'Open Acme' }));
  expect(captureEntryState).toHaveBeenCalledBefore(record.open);
  expect(record.open).toHaveBeenCalledExactlyOnceWith([
    { type: 'company', id: 'acme', name: '' },
  ]);
  expect(screen.getByText('Sales record company:acme')).toBeTruthy();
  expect(screen.queryByText('Sales table')).toBeNull();
  expect(fixture.openWithSplit).not.toHaveBeenCalled();
});

it('returns to the pipeline when its record is open and the pipeline is picked again', () => {
  fixture.touch = false;
  const { activeTab, record } = setup('pipeline:sales');
  fireEvent.click(screen.getByRole('button', { name: 'Open Acme' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sales' }));
  expect(record.close).toHaveBeenCalledOnce();
  expect(activeTab()).toBe('pipeline:sales');
  expect(screen.getByText('Sales table')).toBeTruthy();
});

it('keeps the split close in the header and offers no collapse in the narrow navigation menu', () => {
  fixture.touch = false;
  fixture.narrow = true;
  setup('pipeline:sales');
  const trigger = screen.getByRole('button', { name: 'Show CRM navigation' });
  expect(
    screen.getByRole('button', { name: 'Close split' }).nextElementSibling
  ).toBe(trigger.parentElement);
  fireEvent.click(trigger);
  expect(
    screen.getAllByRole('navigation', { name: 'CRM sidebar' })
  ).toHaveLength(2);
  expect(
    screen.getAllByRole('button', { name: 'Collapse CRM sidebar' })
  ).toHaveLength(1);
  expect(fixture.setCollapsed).not.toHaveBeenCalled();
});

it('keeps the split close beside the collapsed sidebar toggle on a pipeline', () => {
  fixture.touch = false;
  setup('pipeline:sales');
  const close = screen.getByRole('button', { name: 'Close split' });
  expect(close.nextElementSibling?.getAttribute('aria-label')).toBe(
    'Expand CRM sidebar'
  );
});

it('opens the company of a pipeline row in its own split on touch', () => {
  setup('pipeline:sales');
  fireEvent.click(screen.getByRole('button', { name: 'Open Acme' }));
  expect(fixture.openWithSplit).toHaveBeenCalledExactlyOnceWith(
    { type: 'company', id: 'acme' },
    { activate: true }
  );
  expect(screen.getByText('Sales table')).toBeTruthy();
});

it('returns to the list when the open record’s tab is picked again', () => {
  fixture.touch = false;
  const { record } = setup('people');
  record.open([{ type: 'contact', id: 'maya', name: 'Maya' }]);
  expect(screen.getByText('People record contact:maya')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'People' }));
  expect(record.close).toHaveBeenCalledOnce();
  expect(screen.getByText('Record list')).toBeTruthy();
});

it('shows another tab’s list in place of an open record without closing it first', () => {
  fixture.touch = false;
  const { activeTab, record } = setup('pipeline:sales');
  fireEvent.click(screen.getByRole('button', { name: 'Open Acme' }));
  fireEvent.click(screen.getByRole('button', { name: 'People' }));
  expect(record.close).not.toHaveBeenCalled();
  expect(activeTab()).toBe('people');
  expect(screen.getByText('Record list')).toBeTruthy();
});

it('shows CRM settings in place of an open record and returns to it', () => {
  fixture.touch = false;
  const { record } = setup('pipeline:sales');
  fireEvent.click(screen.getByRole('button', { name: 'Open Acme' }));
  fireEvent.click(screen.getByRole('button', { name: 'CRM settings' }));
  expect(screen.getByText('Stage settings')).toBeTruthy();
  expect(screen.queryByText('Sales record company:acme')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close CRM settings' }));
  expect(screen.queryByText('Stage settings')).toBeNull();
  expect(screen.getByText('Sales record company:acme')).toBeTruthy();
  expect(record.close).not.toHaveBeenCalled();
});

it.each([false, true])(
  'returns to the activity feed after closing CRM settings (touch: %s)',
  (touch) => {
    fixture.touch = touch;
    const { activeTab } = setup('tasks');
    expect(screen.getByText('tasks feed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'CRM settings' }));
    expect(screen.getByText('Stage settings')).toBeTruthy();
    expect(screen.queryByText('tasks feed')).toBeNull();
    expect(screen.queryByText('Record list')).toBeNull();
    expect(activeTab()).toBe('tasks');
    fireEvent.click(screen.getByRole('button', { name: 'Close CRM settings' }));
    expect(screen.getByText('tasks feed')).toBeTruthy();
    expect(screen.queryByText('Stage settings')).toBeNull();
    expect(screen.queryByText('Record list')).toBeNull();
  }
);
it('leaves CRM settings for the list picked in the sidebar, including the current one', () => {
  fixture.touch = false;
  const { activeTab } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'CRM settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Companies' }));
  expect(screen.queryByText('Stage settings')).toBeNull();
  expect(screen.getByText('Record list')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'CRM settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'People' }));
  expect(activeTab()).toBe('people');
  expect(screen.queryByText('Stage settings')).toBeNull();
});

it('leaves CRM settings when the route moves elsewhere, as on Back', () => {
  fixture.touch = false;
  const { record } = setup('pipeline:sales');
  fireEvent.click(screen.getByRole('button', { name: 'CRM settings' }));
  record.open([{ type: 'company', id: 'acme', name: '' }]);
  expect(screen.queryByText('Stage settings')).toBeNull();
  expect(screen.getByText('Sales record company:acme')).toBeTruthy();
  record.close();
  expect(screen.getByText('Sales table')).toBeTruthy();
});
