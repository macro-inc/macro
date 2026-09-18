import {
  SearchBar,
  useViewControlHotkeys,
  useViewShell,
  ViewShell,
} from '@app/components/view-shell';
import { NO_ASSIGNEE } from '@app/features/next-soup/filters/configs';
import { NIL_UUID } from '@app/features/next-soup/filters/filter-store';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { SoupActiveFiltersBar } from '@app/features/next-soup/soup-view/filters-bar/soup-active-filters-bar';
import { SoupViewContextGroup } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-group';
import { SoupViewContextSort } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-sort';
import { UnifiedFilterDropdown } from '@app/features/next-soup/soup-view/filters-bar/unified-filter-dropdown';
import { useFilterRefinements } from '@app/features/next-soup/soup-view/filters-bar/use-filter-refinements';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import {
  CompanyDisplayMenu,
  CompanyViewsMenu,
} from '@app/features/next-soup/soup-view/views/companies/CompanyViewsMenu';
import { useApplyCrmView } from '@app/features/next-soup/soup-view/views/companies/use-apply-crm-view';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { usePreference } from '@app/preferences/use-preference';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { enableCrmLists } from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { type EntityData, isCrmCompanyEntity } from '@entity';
import ListIcon from '@phosphor/list.svg';
import { fetchCrmExportCompanies } from '@queries/crm/export';
import { useCrmLists } from '@queries/crm/lists';
import { useQuickAccessCrmCompaniesQuery } from '@queries/soup/quick-access-crm-companies';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { Button, Dropdown, Tooltip } from '@ui';
import { createSignal, type JSX, onMount, Show, Suspense } from 'solid-js';
import { openCreateCompanyModal } from '../CreateCompanyModal';
import { CrmListDialog } from '../components/CrmListDialog';
import { CrmSidebar } from '../components/CrmSidebar';
import { CRM_VIEWS } from '../core/crm-navigation';
import {
  type CrmViewConfig,
  usePersonalCrmViews,
  useTeamCrmViews,
} from '../crm/saved-views';
import { CrmCompanyDetail } from './CrmCompanyDetail';
import { CrmExport } from './CrmExport';
import { CrmImport } from './CrmImport';

function NavigationToggle(props: {
  onExpand: () => void;
  children: import('solid-js').JSX.Element;
}) {
  const shell = useViewShell();
  const [open, setOpen] = createSignal(false);
  return (
    <Show when={shell.aside.isCollapsed()}>
      <Show
        when={shell.breakpoints.narrow?.()}
        fallback={
          <Tooltip label="Expand CRM sidebar">
            <Button
              variant="ghost"
              size="icon-sm"
              label="Expand CRM sidebar"
              onClick={props.onExpand}
            >
              <ListIcon class="size-4" />
            </Button>
          </Tooltip>
        }
      >
        <Dropdown open={open()} onOpenChange={setOpen} placement="bottom-start">
          <Tooltip label="Show CRM navigation">
            <Dropdown.Trigger
              variant="ghost"
              size="icon-sm"
              aria-label="Show CRM navigation"
            >
              <ListIcon class="size-4" />
            </Dropdown.Trigger>
          </Tooltip>
          <Dropdown.Content class="w-55 max-h-[80vh] overflow-auto p-0">
            <div
              onClick={(event) => {
                if (
                  (event.target as HTMLElement).closest(
                    'nav button, [role="radiogroup"]'
                  )
                )
                  setOpen(false);
              }}
            >
              {props.children}
            </div>
          </Dropdown.Content>
        </Dropdown>
      </Show>
    </Show>
  );
}

function CrmSearchBar() {
  const view = useSoupView();
  const panel = useSplitPanelOrThrow();
  let input: HTMLInputElement | undefined;
  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    search: {
      description: 'Search companies',
      run: () => {
        input?.focus();
        input?.select();
        return true;
      },
    },
  });
  return (
    <SearchBar
      ref={(element) => (input = element)}
      label="Search companies"
      placeholder="Search companies"
      value={view.searchText()}
      onValueChange={view.setSearchText}
      onEscape={() => panel.panelRef()?.focus()}
      hotkey="cmd+f"
      class="max-w-md flex-1"
    />
  );
}

function CrmFilterChips(props: { onReset: () => void }) {
  const { consolidatedFiltersList } = useFilterRefinements();
  const view = useSoupView();
  const userId = useUserId();
  const filters = () =>
    consolidatedFiltersList().filter((filter) => {
      const defaultOwner =
        view.activeTab() === 'my-companies'
          ? userId()
          : view.activeTab() === 'unassigned'
            ? NO_ASSIGNEE
            : undefined;
      return !(
        filter.key === 'owner' &&
        defaultOwner &&
        filter.values().length === 1 &&
        filter.values()[0].id === defaultOwner
      );
    });
  return (
    <SoupActiveFiltersBar filters={filters()} onClearAll={props.onReset} />
  );
}

export function CrmWorkspace(props: {
  children: (onOpenEntity: (entity: EntityData) => boolean) => JSX.Element;
}) {
  const view = useSoupView();
  const panel = useSplitPanelOrThrow();
  const [selectedCompany, setSelectedCompany] = createSignal<{
    id: string;
    name: string;
  }>();
  const closeCompany = () => setSelectedCompany(undefined);
  const openCompany = (entity: EntityData) => {
    if (!isCrmCompanyEntity(entity)) return false;
    view.soup.focus.set(entity.id);
    panel.handle.captureEntryState();
    setSelectedCompany({ id: entity.id, name: entity.name });
    return true;
  };
  const apply = useApplyCrmView();
  const userId = useUserId();
  const { openSettings } = useSettingsState();
  const [collapsed, setCollapsed] = usePreference(
    'macro:pref:crm:sidebar-collapsed',
    { default: false }
  );
  const teamQuery = useCurrentTeamQuery();
  const teamId = () =>
    teamQuery.isSuccess ? teamQuery.data?.team.id : undefined;
  const listsFlag = useFeatureFlag(enableCrmLists);
  const lists = useCrmLists(() => (listsFlag().enabled ? teamId() : undefined));
  const personal = usePersonalCrmViews();
  const team = useTeamCrmViews();
  const savedViews = () => [
    ...personal
      .views()
      .map((v) => ({ id: `personal:${v.id}`, name: v.name, config: v.config })),
    ...team.views().map((v) => ({
      id: `team:${v.id}`,
      name: v.name,
      config: v.config as CrmViewConfig,
    })),
  ];
  const [editing, setEditing] = createSignal<{
    id?: string;
    name: string;
    companyIds: string[];
  }>();
  const [importing, setImporting] = createSignal(false);
  const active = () =>
    view.activeTab() === 'people' ? 'active' : (view.activeTab() ?? 'active');
  const [exporting, setExporting] = createSignal(false);
  const activeList = () =>
    lists.lists().find((list) => `list:${list.id}` === active());
  const title = () =>
    activeList()?.name ??
    savedViews().find((v) => v.id === active())?.name ??
    CRM_VIEWS.find((v) => v.id === active())?.label ??
    'Companies';
  const navigate = (id: string) => {
    if (!listsFlag().enabled && id.startsWith('list:')) id = 'active';
    closeCompany();
    const saved = savedViews().find((v) => v.id === id);
    if (saved) {
      apply({ ...saved.config, viewMode: view.viewMode() });
      view.setActiveTab(id);
      return;
    }
    const preset = getViewPreset('companies');
    const list = lists.lists().find((list) => `list:${list.id}` === id);
    const filters = structuredClone(preset?.filters ?? {});
    if (list)
      filters.include = {
        ...filters.include,
        crmCompanyId: list.config.companyIds.length
          ? list.config.companyIds
          : [NIL_UUID],
      };
    apply({
      kind: 'crm',
      activeTab: id,
      filters,
      clientFilters: {
        and: [
          'crm-company-active',
          ...(id === 'needs-follow-up'
            ? ['company-needs-follow-up']
            : id === 'recently-active'
              ? ['company-recently-active']
              : []),
        ],
      },
      ownerFilter:
        id === 'my-companies'
          ? [userId() ?? NIL_UUID]
          : id === 'unassigned'
            ? [NO_ASSIGNEE]
            : [],
      groupBy: preset?.groupBy,
      viewMode: view.viewMode(),
    });
  };
  onMount(() => {
    if (!listsFlag().enabled && active().startsWith('list:'))
      navigate('active');
  });
  const sidebar = () => (
    <CrmSidebar
      active={active()}
      viewMode={view.viewMode()}
      onViewModeChange={(mode) => {
        closeCompany();
        view.setViewMode(mode);
      }}
      lists={lists.lists().map((list) => ({
        id: list.id,
        name: list.name,
        count: list.config.companyIds.length,
      }))}
      savedViews={savedViews()}
      listsEnabled={listsFlag().enabled}
      listsLoading={lists.query.isLoading}
      listsError={lists.query.isError}
      canCreateList={!!teamId()}
      onNavigate={navigate}
      onCreate={openCreateCompanyModal}
      onNewList={() => setEditing({ name: '', companyIds: [] })}
      onImport={() => setImporting(true)}
      onExport={() => setExporting(true)}
      onSettings={() => openSettings('CRM')}
      onCollapse={() => setCollapsed(true)}
    />
  );
  return (
    <ViewShell.Root
      class="touch:pt-(--safe-top) touch:pb-(--mobile-content-inset-bottom)"
      aside={collapsed() ? false : {}}
      main={{ min: 320 }}
    >
      <ViewShell.Aside>
        <Suspense
          fallback={<div class="p-4 text-sm text-ink-muted">Loading CRM…</div>}
        >
          {sidebar()}
        </Suspense>
      </ViewShell.Aside>
      <ViewShell.Main>
        <Show when={selectedCompany()}>
          {(company) => (
            <CrmCompanyDetail
              company={company()}
              viewName={title()}
              onClose={closeCompany}
              navigation={
                <NavigationToggle onExpand={() => setCollapsed(false)}>
                  <Suspense>{sidebar()}</Suspense>
                </NavigationToggle>
              }
            />
          )}
        </Show>
        <Show when={!selectedCompany()}>
          <div class="flex h-12 shrink-0 items-center gap-3 border-b border-edge-muted px-4">
            <NavigationToggle onExpand={() => setCollapsed(false)}>
              <Suspense>{sidebar()}</Suspense>
            </NavigationToggle>
            <h1
              class="flex h-7 min-w-0 flex-1 items-center px-1 text-sm font-semibold tracking-[-0.03em]"
              title={title()}
            >
              <span class="truncate">{title()}</span>
            </h1>
          </div>
          <ViewShell.Header>
            <div class="flex min-w-0 items-center justify-between gap-3">
              <CrmSearchBar />
              <div class="ml-auto flex shrink-0 items-center gap-2 [&_button]:h-8 [&_button]:min-w-8 [&_button]:rounded-lg [&_button>svg]:size-4!">
                <SoupViewContextSort />
                <SoupViewContextGroup hideLabel />
                <UnifiedFilterDropdown hideLabel />
                <CompanyDisplayMenu />
                <Suspense>
                  <CompanyViewsMenu hideLabel />
                </Suspense>
                <Show when={listsFlag().enabled && activeList()}>
                  {(list) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setEditing({
                          id: list().id,
                          name: list().name,
                          companyIds: [...list().config.companyIds],
                        })
                      }
                    >
                      Edit list
                    </Button>
                  )}
                </Show>
              </div>
            </div>
          </ViewShell.Header>
          <Suspense>
            <CrmFilterChips onReset={() => navigate(active())} />
          </Suspense>
          <div class="min-h-0 min-w-0 flex-1">
            {props.children(openCompany)}
          </div>
        </Show>
      </ViewShell.Main>
      <Show when={listsFlag().enabled && editing()}>
        {(initial) => {
          const companies = useQuickAccessCrmCompaniesQuery();
          return (
            <CrmListDialog
              initial={
                initial().id ? { ...initial(), id: initial().id! } : undefined
              }
              companies={companies.companies()}
              loading={companies.query.isLoading}
              onClose={() => setEditing(undefined)}
              onSave={async (name, companyIds) => {
                const id = await lists.save.mutateAsync({
                  id: initial().id,
                  name,
                  companyIds,
                });
                navigate(`list:${id}`);
              }}
              onDelete={
                initial().id
                  ? async () => {
                      await lists.remove.mutateAsync(initial().id!);
                      navigate('active');
                    }
                  : undefined
              }
            />
          );
        }}
      </Show>
      <Show when={exporting()}>
        <CrmExport
          kind="companies"
          currentView={title()}
          onClose={() => setExporting(false)}
          onLoad={async (scope, signal, progress) => {
            const wait = async () => {
              signal.throwIfAborted();
              await new Promise((resolve) => setTimeout(resolve, 100));
            };
            if (scope === 'all')
              return {
                companies: await fetchCrmExportCompanies(signal, progress),
              };
            while (view.source.isFetching()) await wait();
            if (view.source.error())
              throw new Error('Could not load this view. Please retry.');
            while (view.source.hasNextPage()) {
              signal.throwIfAborted();
              await view.source.fetchNextPage();
              await wait();
              if (view.source.error())
                throw new Error(
                  'Could not load the entire view. Please retry.'
                );
              progress(view.source.data().length);
            }
            signal.throwIfAborted();
            let current = view.source.data().filter(isCrmCompanyEntity);
            if (current.some((company) => !company.properties)) {
              const full = new Map(
                (await fetchCrmExportCompanies(signal, progress)).map(
                  (company) => [company.id, company]
                )
              );
              current = current.map(
                (company) => full.get(company.id) ?? company
              );
            }
            return { companies: current };
          }}
        />
      </Show>
      <Show when={importing()}>
        <CrmImport onClose={() => setImporting(false)} />
      </Show>
    </ViewShell.Root>
  );
}
