import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { createSignal, type JSX, type ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { CrmWorkspaceView } from './crm-workspace';

const fixture = vi.hoisted(() => ({
  workspace: undefined as unknown,
  pipelinesEnabled: true,
  listsEnabled: true,
}));

vi.mock('@app/components/view-shell', () => ({
  ViewShell: {
    Root: (props: ParentProps) => props.children,
    Aside: () => null,
    Main: (props: ParentProps) => props.children,
    Header: (props: ParentProps) => <header>{props.children}</header>,
  },
  useViewShell: () => ({
    aside: { isCollapsed: () => true },
    breakpoints: { narrow: () => false },
  }),
  useViewControlHotkeys: () => {},
  SearchBar: () => null,
}));
vi.mock('@app/preferences/use-preference', () => ({
  usePreference: () => createSignal(false),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
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
vi.mock('../components/crm-sidebar', () => ({ CrmSidebar: () => null }));
vi.mock('../components/pipeline-sidebar', () => ({
  PipelineSidebar: () => null,
}));
vi.mock('../components/pipeline-dialog', () => ({
  PipelineDialog: () => null,
}));
vi.mock('./record-detail', () => ({ CrmRecordDetail: () => null }));
vi.mock('./export-companies', () => ({ CrmExport: () => null }));
vi.mock('./import-companies', () => ({ CrmImport: () => null }));
vi.mock('./pipeline', () => ({
  PipelineView: (props: { pipeline: { name: string } }) => (
    <div>{props.pipeline.name} table</div>
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
});

function setup() {
  const [activeTab, setActiveTab] = createSignal<string | undefined>('active');
  fixture.workspace = {
    activeTab,
    setActiveTab,
    host: { scopeId: 'crm', isActive: () => true },
    source: {},
    queryFilters: { state: { include: {} } },
  };
  render(() => (
    <CrmWorkspaceView>{() => <div>Record list</div>}</CrmWorkspaceView>
  ));
  return { activeTab };
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
  ).toEqual(['Companies', 'People']);
});
