import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import {
  createSignal,
  For,
  type JSX,
  onCleanup,
  type ParentProps,
  Show,
} from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSettingsPage } from '../primitives/settings-page';
import { CrmWorkspaceView } from './crm-workspace';

const fixture = vi.hoisted(() => ({
  workspace: undefined as unknown,
  canAccess: (): boolean => true,
  accessState: undefined as
    | (() => 'pending' | 'allowed' | 'denied' | 'error')
    | undefined,
  listsEnabled: true,
  touch: true,
  width: 600,
  openWithSplit: vi.fn(),
  activityFlag: () => ({ enabled: true, loading: false }),
  root: vi.fn(),
  saveList: vi.fn(),
  saved: undefined as Promise<void> | undefined,
  recordMounted: vi.fn(),
  recordDisposed: vi.fn(),
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => fixture.activityFlag(),
}));
vi.mock('@app/components/view-shell', () => ({
  CollectionPanes: (props: {
    hasDetail: boolean;
    list: JSX.Element;
    children: JSX.Element;
  }) => (
    <>
      <Show when={(fixture.touch && fixture.width > 720) || !props.hasDetail}>
        {props.list}
      </Show>
      <Show when={props.hasDetail}>{props.children}</Show>
    </>
  ),
  asideCollapsedPreferenceKey: (app: string) =>
    `macro:pref:view-sidebar:collapsed:${app}`,
  ViewShell: {
    Root: (props: ParentProps<{ asidePreferenceKey?: string }>) => {
      fixture.root(
        props.asidePreferenceKey,
        localStorage.getItem('macro:pref:view-sidebar:collapsed:crm')
      );
      return props.children;
    },
    Aside: (props: ParentProps) => props.children,
    Main: (props: ParentProps) => props.children,
    Header: (props: ParentProps) => <header>{props.children}</header>,
  },
  ViewSidebar: {
    Title: (props: ParentProps) => <h1>{props.children}</h1>,
    Toggle: () => <button type="button" aria-label="Show navigation" />,
  },
  ViewNavigationControls: () => (
    <div role="group" aria-label="Navigation controls" />
  ),
  useViewControlHotkeys: () => {},
  SearchBar: () => null,
}));
vi.mock('@components/app/split-layout/context', async () => {
  const { createContext } = await import('solid-js');
  return {
    SplitLayoutContext: createContext(),
    SplitPanelContext: createContext({
      panelSize: {
        get width() {
          return fixture.width;
        },
      },
    }),
  };
});
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
  EmptyStatePanel: (props: { title: string }) => <p>{props.title}</p>,
  Tooltip: (props: ParentProps) => props.children,
  Button: (
    props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label?: string }
  ) => <button aria-label={props.label} {...props} />,
  Dropdown: () => null,
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
  CrmListDialog: (props: {
    onSave(name: string, companyIds: string[]): Promise<void>;
  }) => (
    <button
      type="button"
      onClick={() => {
        fixture.saved = props.onSave('Saved list', ['company']);
      }}
    >
      Save list
    </button>
  ),
}));
vi.mock('../components/crm-sidebar', () => ({
  CrmSidebar: (props: {
    pipelines?: JSX.Element;
    onNavigate: (id: string) => void;
    onSettings: () => void;
    canAccess: boolean;
    canCreateList: boolean;
    onNewList: () => void;
    onImport: () => void;
  }) => (
    <nav aria-label="CRM sidebar">
      <Show when={props.canAccess}>
        <button type="button" onClick={() => props.onNavigate('active')}>
          Companies
        </button>
        <button type="button" onClick={() => props.onNavigate('people')}>
          People
        </button>
        <button type="button" onClick={props.onNewList}>
          New list
        </button>
      </Show>
      {props.pipelines}
      <button
        type="button"
        disabled={!props.canCreateList}
        onClick={props.onImport}
      >
        Import
      </button>
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
vi.mock('./item-detail', () => ({ CrmItemDetail: () => null }));
vi.mock('./record-detail', () => ({
  CrmRecordDetail: (props: {
    viewName: string;
    records: { type: string; id: string }[];
  }) => {
    fixture.recordMounted();
    onCleanup(fixture.recordDisposed);
    return (
      <div>
        {props.viewName} record{' '}
        {props.records.map((record) => `${record.type}:${record.id}`).join(' ')}
      </div>
    );
  },
}));
vi.mock('./crm-settings', () => ({ Crm: () => <div>Stage settings</div> }));
vi.mock('./export-companies', () => ({ CrmExport: () => null }));
vi.mock('./import-companies', () => ({
  CrmImport: () => <div>Import dialog</div>,
}));
vi.mock('./email-privacy', () => ({ CrmEmailOptInBanner: () => null }));
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
    canAccess: () => fixture.canAccess(),
    accessState: () =>
      fixture.accessState?.() ?? (fixture.canAccess() ? 'allowed' : 'denied'),
    retryAccess: async () => {},
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
    data: { team: { id: 'team', crm_enabled: false } },
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
    save: { mutateAsync: fixture.saveList },
  }),
  useQuickAccessCrmCompaniesQuery: () => ({
    companies: () => [],
    query: { isLoading: false },
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
  fixture.canAccess = () => true;
  fixture.accessState = undefined;
  cleanup();
  fixture.listsEnabled = true;
  fixture.touch = true;
  fixture.width = 600;
  fixture.openWithSplit.mockReset();
  fixture.root.mockReset();
  fixture.saveList.mockReset();
  fixture.saved = undefined;
  fixture.recordMounted.mockReset();
  fixture.recordDisposed.mockReset();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
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
  const [item, setItem] = createSignal<{
    itemType: string;
    itemId: string;
  }>();
  const record = {
    records,
    section: () => undefined,
    commentTarget: () => undefined,
    item,
    openItem: vi.fn(setItem),
    closeItem: vi.fn(() => setItem(undefined)),
    open: vi.fn(setRecords),
    setSection: vi.fn(),
    close: vi.fn(() => {
      setRecords([]);
      setItem(undefined);
    }),
  };
  const setActiveTab = (tab: string) => {
    setRecords([]);
    setItem(undefined);
    setTab(tab);
  };
  const captureEntryState = vi.fn();
  const settings = createSettingsPage(() =>
    [activeTab(), ...records().map((record) => record.id)].join(' ')
  );
  fixture.workspace = {
    peopleVisibility: { canShowRemoved: () => false, showRemoved: () => false },
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
    screen.queryByRole('group', { name: 'Navigation controls' })
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

it('omits lists when that feature is disabled', () => {
  fixture.listsEnabled = false;
  setup();
  const tabs = within(screen.getByRole('navigation', { name: 'CRM views' }));
  expect(
    tabs
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('aria-pressed'))
      .map((button) => button.textContent)
  ).toEqual([
    'Companies',
    'People',
    'Sales Tasks',
    'Sales Email',
    'Sales Notes',
    'Sales Calls',
    'Sales',
  ]);
});

it('opens each CRM activity feed instead of the company list', () => {
  const { activeTab } = setup();
  const tabs = within(screen.getByRole('navigation', { name: 'CRM views' }));
  for (const [label, id] of [
    ['Sales Tasks', 'tasks'],
    ['Sales Email', 'email'],
    ['Sales Notes', 'notes'],
    ['Sales Calls', 'calls'],
  ]) {
    fireEvent.click(tabs.getByRole('button', { name: label }));
    expect(activeTab()).toBe(id);
    expect(screen.getByText(`${id} feed`)).toBeTruthy();
    expect(screen.queryByText('Record list')).toBeNull();
  }
  fireEvent.click(tabs.getByRole('button', { name: 'Companies' }));
  expect(screen.getByText('Record list')).toBeTruthy();
});

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

it('opens a pipeline record inline on wide touch', () => {
  fixture.width = 1000;
  const { record, captureEntryState } = setup('pipeline:sales');
  fireEvent.click(screen.getByRole('button', { name: 'Open Acme' }));
  expect(captureEntryState).toHaveBeenCalledBefore(record.open);
  expect(record.open).toHaveBeenCalledExactlyOnceWith([
    { type: 'company', id: 'acme', name: '' },
  ]);
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

it('puts the shell navigation controls in pipeline and settings headers on desktop', () => {
  fixture.touch = false;
  setup('pipeline:sales');
  expect(fixture.root).toHaveBeenCalledWith('crm', null);
  expect(
    screen.getByRole('group', { name: 'Navigation controls' }).parentElement
      ?.tagName
  ).toBe('HEADER');
  fireEvent.click(screen.getByRole('button', { name: 'CRM settings' }));
  expect(
    screen.getByRole('group', { name: 'Navigation controls' })
  ).toBeTruthy();
});

it('moves a collapsed sidebar saved under the old CRM key to the shell preference', () => {
  localStorage.setItem('macro:pref:crm:sidebar-collapsed', 'true');
  setup();
  expect(fixture.root).toHaveBeenCalledWith('crm', 'true');
  expect(localStorage.getItem('macro:pref:crm:sidebar-collapsed')).toBeNull();
});

it('keeps the shell preference over a choice saved under the old CRM key', () => {
  localStorage.setItem('macro:pref:crm:sidebar-collapsed', 'true');
  localStorage.setItem('macro:pref:view-sidebar:collapsed:crm', 'false');
  setup();
  expect(fixture.root).toHaveBeenCalledWith('crm', 'false');
  expect(localStorage.getItem('macro:pref:crm:sidebar-collapsed')).toBeNull();
});

it('keeps the old CRM choice and renders when saving the shell preference fails', () => {
  const values = new Map([['macro:pref:crm:sidebar-collapsed', 'true']]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    },
    removeItem: (key: string) => values.delete(key),
  });
  setup();
  expect(fixture.root).toHaveBeenCalledWith('crm', null);
  expect(values.get('macro:pref:crm:sidebar-collapsed')).toBe('true');
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
  fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
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

it('retains an individually shared pipeline while denying the records workspace', () => {
  const [allowed, setAllowed] = createSignal(true);
  fixture.canAccess = allowed;
  const workspace = setup('pipeline:sales');
  expect(screen.getByText('Sales table')).toBeTruthy();
  setAllowed(false);
  expect(screen.getByText('Sales table')).toBeTruthy();
  const tabs = within(screen.getByRole('navigation', { name: 'CRM views' }));
  expect(tabs.queryByRole('tab', { name: 'Companies' })).toBeNull();
  expect(tabs.queryByText('Favorites')).toBeNull();
  workspace.activeTab();
  fixture.workspace &&
    (fixture.workspace as { setActiveTab(tab: string): void }).setActiveTab(
      'active'
    );
  expect(screen.getByText("You don't have access to CRM")).toBeTruthy();
  expect(screen.queryByText('Record list')).toBeNull();
  setAllowed(true);
  expect(screen.getByText('Record list')).toBeTruthy();
});

it.each([false, true])(
  'can navigate from denied records to an individually shared pipeline (touch: %s)',
  (touch) => {
    fixture.touch = touch;
    fixture.canAccess = () => false;
    const { activeTab } = setup();
    expect(screen.getByText("You don't have access to CRM")).toBeTruthy();
    const navigation = within(
      screen.getByRole('navigation', {
        name: touch ? 'CRM views' : 'CRM sidebar',
      })
    );
    if (!touch)
      expect(
        screen.getByRole('group', { name: 'Navigation controls' })
      ).toBeTruthy();
    fireEvent.click(navigation.getByRole('button', { name: 'Sales' }));
    expect(activeTab()).toBe('pipeline:sales');
    expect(screen.getByText('Sales table')).toBeTruthy();
    expect(screen.queryByText('Record list')).toBeNull();
  }
);

it('preserves a saved list route through an initial denial and later grant', () => {
  const [allowed, setAllowed] = createSignal(false);
  fixture.canAccess = allowed;
  const { activeTab } = setup('list:favorites');
  expect(activeTab()).toBe('list:favorites');
  expect(screen.getByText("You don't have access to CRM")).toBeTruthy();
  expect(screen.queryByText('Record list')).toBeNull();
  setAllowed(true);
  expect(activeTab()).toBe('list:favorites');
  expect(screen.getByText('Record list')).toBeTruthy();
});

it.each([
  { tab: 'active', detail: 'record', canNavigate: true },
  { tab: 'pipeline:sales', detail: 'record', canNavigate: true },
  { tab: 'active', detail: 'item', canNavigate: true },
  { tab: 'pipeline:sales', detail: 'item', canNavigate: false },
])(
  'preserves mobile navigation after revoking an open $detail on $tab',
  ({ tab, detail, canNavigate }) => {
    const [allowed, setAllowed] = createSignal(true);
    fixture.canAccess = allowed;
    const { activeTab, record } = setup(tab);
    if (detail === 'record')
      record.open([{ type: 'company', id: 'company', name: '' }]);
    else record.openItem({ itemType: 'document', itemId: 'shared-note' });
    expect(screen.queryByRole('navigation', { name: 'CRM views' })).toBeNull();

    setAllowed(false);
    const navigation = screen.queryByRole('navigation', {
      name: 'CRM views',
    });
    if (!canNavigate) {
      expect(navigation).toBeNull();
      return;
    }
    const tabs = within(screen.getByRole('navigation', { name: 'CRM views' }));
    expect(tabs.queryByRole('button', { name: 'Companies' })).toBeNull();
    expect(tabs.queryByRole('button', { name: 'Favorites' })).toBeNull();
    fireEvent.click(tabs.getByRole('button', { name: 'Sales' }));
    expect(activeTab()).toBe('pipeline:sales');
    expect(record.records()).toEqual([]);
    expect(record.item()).toBeUndefined();
    expect(screen.getByText('Sales table')).toBeTruthy();
  }
);

it('waits for the initial CRM proof before choosing the deep-link fallback', () => {
  const [state, setState] = createSignal<'pending' | 'allowed' | 'denied'>(
    'pending'
  );
  fixture.accessState = state;
  fixture.canAccess = () => state() === 'allowed';
  setup('list:favorites');
  expect(screen.queryByText("You don't have access to CRM")).toBeNull();
  expect(screen.queryByText('Record list')).toBeNull();
  setState('allowed');
  expect(screen.getByText('Record list')).toBeTruthy();
  setState('denied');
  expect(screen.getByText("You don't have access to CRM")).toBeTruthy();
});

it('unmounts the open record at the workspace boundary on denial and restores it on regrant', () => {
  const [allowed, setAllowed] = createSignal(true);
  fixture.canAccess = allowed;
  const { record } = setup('pipeline:sales');
  record.open([{ type: 'company', id: 'company', name: '' }]);
  expect(fixture.recordMounted).toHaveBeenCalledOnce();
  setAllowed(false);
  expect(fixture.recordDisposed).toHaveBeenCalledOnce();
  expect(screen.queryByText('Sales record company:company')).toBeNull();
  expect(screen.getByText("You don't have access to CRM")).toBeTruthy();
  setAllowed(true);
  expect(fixture.recordMounted).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Sales record company:company')).toBeTruthy();
});

it.each(['pending', 'error'] as const)(
  'keeps navigation available while the records workspace is %s',
  (state) => {
    fixture.canAccess = () => false;
    fixture.accessState = () => state;
    const { activeTab } = setup();
    const navigation = within(
      screen.getByRole('navigation', { name: 'CRM views' })
    );
    fireEvent.click(navigation.getByRole('button', { name: 'People' }));
    expect(activeTab()).toBe('people');
    expect(screen.queryByText('Record list')).toBeNull();
    expect(screen.queryByText("You don't have access to CRM")).toBeNull();
  }
);

it('does not open an import requested before CRM access was proven', () => {
  const [state, setState] = createSignal<'pending' | 'allowed'>('pending');
  fixture.accessState = state;
  fixture.canAccess = () => state() === 'allowed';
  fixture.touch = false;
  setup();
  const sidebar = within(
    screen.getByRole('navigation', { name: 'CRM sidebar' })
  );
  fireEvent.click(sidebar.getByRole('button', { name: 'Import' }));
  setState('allowed');
  expect(screen.queryByText('Import dialog')).toBeNull();
  fireEvent.click(sidebar.getByRole('button', { name: 'Import' }));
  expect(screen.getByText('Import dialog')).toBeTruthy();
});

it.each([false, true])(
  'does not open a shared pipeline record after denial (touch: %s)',
  (touch) => {
    fixture.touch = touch;
    fixture.canAccess = () => false;
    const { record } = setup('pipeline:sales');
    fireEvent.click(screen.getByRole('button', { name: 'Open Acme' }));
    expect(record.open).not.toHaveBeenCalled();
    expect(fixture.openWithSplit).not.toHaveBeenCalled();
    expect(screen.getByText('Sales table')).toBeTruthy();
  }
);

it('offers pipeline navigation instead of a denied Companies destination', () => {
  fixture.touch = false;
  fixture.canAccess = () => false;
  const { activeTab } = setup('pipeline:unavailable');
  expect(
    screen.queryByRole('button', { name: 'Back to companies' })
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show navigation' }));
  const navigation = within(
    screen.getByRole('navigation', { name: 'CRM sidebar' })
  );
  fireEvent.click(navigation.getByRole('button', { name: 'Sales' }));
  expect(activeTab()).toBe('pipeline:sales');
  expect(screen.getByText('Sales table')).toBeTruthy();
});

it('keeps a shared pipeline open when a list save commits after denial', async () => {
  const result = Promise.withResolvers<string>();
  fixture.saveList.mockReturnValue(result.promise);
  const [allowed, setAllowed] = createSignal(true);
  fixture.canAccess = allowed;
  fixture.touch = false;
  const { activeTab } = setup('pipeline:sales');
  fireEvent.click(screen.getByRole('button', { name: 'New list' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save list' }));
  expect(fixture.saveList).toHaveBeenCalledOnce();
  setAllowed(false);
  result.resolve('saved');
  await fixture.saved;
  expect(activeTab()).toBe('pipeline:sales');
  expect(screen.getByText('Sales table')).toBeTruthy();
});
