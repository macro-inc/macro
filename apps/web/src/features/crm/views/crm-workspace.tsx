import {
  SearchBar,
  useViewControlHotkeys,
  useViewShell,
  ViewShell,
} from '@app/components/view-shell';
import { VIEW_SHELL_TOUR } from '@app/components/view-shell/tour';
import { NO_ASSIGNEE } from '@app/features/next-soup/filters/configs';
import { NIL_UUID } from '@app/features/next-soup/filters/filter-store';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { SoupActiveFiltersBar } from '@app/features/next-soup/soup-view/filters-bar/soup-active-filters-bar';
import { SoupViewContextGroup } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-group';
import { SoupViewContextSort } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-sort';
import { UnifiedFilterDropdown } from '@app/features/next-soup/soup-view/filters-bar/unified-filter-dropdown';
import { useFilterRefinements } from '@app/features/next-soup/soup-view/filters-bar/use-filter-refinements';
import { usePreference } from '@app/preferences/use-preference';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type EntityData, isCrmCompanyEntity } from '@entity';
import ListIcon from '@phosphor/list.svg';
import { Button, Dropdown, Tooltip } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { createSignal, type JSX, onMount, Show, Suspense } from 'solid-js';
import { CrmListDialog } from '../components/company-list-dialog';
import { CrmSidebar } from '../components/crm-sidebar';
import { useCrmContext } from '../context/crm-context';
import { useCrmWorkspace } from '../context/workspace-context';
import { CRM_VIEWS } from '../core/navigation';
import type { PeopleSort } from '../core/people';
import type { CrmViewConfig } from '../core/saved-view';
import { createCrmExportLoader } from '../primitives/export-source';
import { useApplyCrmView } from './apply-view';
import { CrmExport } from './export-companies';
import { CrmImport } from './import-companies';
import { CrmPeople } from './people';
import { CrmCompanyDetail } from './record-detail';
import { CompanyDisplayMenu, CompanyViewsMenu } from './saved-views-menu';
import {
  useCrmLists,
  useCurrentTeamQuery,
  usePersonalCrmViews,
  useQuickAccessCrmCompaniesQuery,
  useTeamCrmViews,
  useCrmUserId as useUserId,
} from './use-crm';

function NavigationToggle(props: {
  onExpand: () => void;
  children: import('solid-js').JSX.Element;
}) {
  const shell = useViewShell();
  const [open, setOpen] = createSignal(false);
  // CRM collapses its own sidebar, so its toggle stands in for the shell's.
  const toggleTarget = tourTarget(VIEW_SHELL_TOUR.sidebarToggle);
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
              ref={toggleTarget}
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
              depth={isTouchDevice() ? 3 : undefined}
              class="touch:island touch:pointer-events-auto touch:size-10 touch:shrink-0 touch:bg-chrome"
              aria-label="Show CRM navigation"
              ref={toggleTarget}
            >
              <ListIcon class="size-4 touch:size-6" />
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
  const view = useCrmWorkspace();
  let input: HTMLInputElement | undefined;
  useViewControlHotkeys({
    scopeId: view.host.scopeId,
    enabled: view.host.isActive,
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
      onEscape={view.host.focus}
      hotkey="cmd+f"
      class="max-w-md flex-1"
    />
  );
}

function CrmFilterChips(props: { onReset: () => void }) {
  const { consolidatedFiltersList } = useFilterRefinements();
  const view = useCrmWorkspace();
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

export function CrmWorkspaceView(props: {
  children: (options: {
    onOpenEntity?: (entity: EntityData) => boolean;
    mobileHeaderLeading?: JSX.Element;
  }) => JSX.Element;
}) {
  const {
    openCreateCompany: openCreateCompanyModal,
    exportCompanies: fetchCrmExportCompanies,
  } = useCrmContext();
  const view = useCrmWorkspace();
  const [selectedCompany, setSelectedCompany] = createSignal<{
    id: string;
    name: string;
  }>();
  const closeCompany = () => setSelectedCompany(undefined);
  const openCompany = (entity: EntityData) => {
    if (!isCrmCompanyEntity(entity)) return false;
    view.soup.focus.set(entity.id);
    view.host.captureEntryState();
    setSelectedCompany({ id: entity.id, name: entity.name });
    return true;
  };
  const apply = useApplyCrmView();
  const userId = useUserId();
  const [collapsed, setCollapsed] = usePreference(
    'macro:pref:crm:sidebar-collapsed',
    { default: false }
  );
  const teamQuery = useCurrentTeamQuery();
  const teamId = () =>
    teamQuery.isSuccess ? teamQuery.data?.team.id : undefined;
  const listsEnabled = useCrmContext().listsEnabled();
  const lists = useCrmLists(() => (listsEnabled() ? teamId() : undefined));
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
  const active = () => view.activeTab() ?? 'active';
  const peopleActive = () => active() === 'people';
  const directory = useCrmContext().createPeopleSource(peopleActive);
  const [peopleSearch, setPeopleSearch] = createSignal('');
  const [peopleSort, setPeopleSort] =
    createSignal<PeopleSort>('lastInteraction');
  const [peopleDescending, setPeopleDescending] = createSignal(true);
  const [exporting, setExporting] = createSignal(false);
  const activeList = () =>
    lists.lists().find((list) => `list:${list.id}` === active());
  const title = () =>
    activeList()?.name ??
    savedViews().find((v) => v.id === active())?.name ??
    CRM_VIEWS.find((v) => v.id === active())?.label ??
    'Companies';
  const navigate = (id: string) => {
    if (!listsEnabled() && id.startsWith('list:')) id = 'active';
    closeCompany();
    if (id === 'people') {
      view.setActiveTab(id);
      return;
    }
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
    if (!listsEnabled() && active().startsWith('list:')) navigate('active');
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
      listsEnabled={listsEnabled()}
      listsLoading={lists.query.isLoading}
      listsError={lists.query.isError}
      canCreateList={!!teamId()}
      onNavigate={navigate}
      onCreate={openCreateCompanyModal}
      onNewList={() => setEditing({ name: '', companyIds: [] })}
      onImport={() => setImporting(true)}
      onExport={() => setExporting(true)}
      onSettings={view.host.openSettings}
      onCollapse={() => setCollapsed(true)}
    />
  );
  return (
    <ViewShell.Root aside={collapsed() ? false : {}} main={{ min: 320 }}>
      <ViewShell.Aside>
        <Suspense
          fallback={<div class="p-4 text-sm text-ink-muted">Loading CRM…</div>}
        >
          {sidebar()}
        </Suspense>
      </ViewShell.Aside>
      <ViewShell.Main>
        <Show when={selectedCompany()} keyed>
          {(company) => (
            <CrmCompanyDetail
              company={company}
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
          <Show when={!isTouchDevice() || peopleActive()}>
            <div class="flex h-12 shrink-0 items-center gap-3 px-4">
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
            <Show when={!peopleActive()}>
              <ViewShell.Header>
                <div class="flex min-w-0 items-center justify-between gap-3">
                  <CrmSearchBar />
                  <div class="ml-auto flex shrink-0 items-center gap-2 [&_button]:h-8 [&_button]:min-w-8 [&_button>svg]:size-4!">
                    <SoupViewContextSort />
                    <SoupViewContextGroup hideLabel variant="ghost" />
                    <UnifiedFilterDropdown hideLabel variant="ghost" />
                    <CompanyDisplayMenu />
                    <Suspense>
                      <CompanyViewsMenu hideLabel />
                    </Suspense>
                    <Show when={listsEnabled() && activeList()}>
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
            </Show>
          </Show>
          <div class="flex min-h-0 min-w-0 flex-1 flex-col">
            <Show
              when={peopleActive()}
              fallback={props.children({
                onOpenEntity: isTouchDevice() ? undefined : openCompany,
                mobileHeaderLeading: isTouchDevice() ? (
                  <NavigationToggle onExpand={() => setCollapsed(false)}>
                    <Suspense>{sidebar()}</Suspense>
                  </NavigationToggle>
                ) : undefined,
              })}
            >
              <CrmPeople
                directory={directory}
                search={peopleSearch()}
                onSearch={setPeopleSearch}
                sort={peopleSort()}
                onSort={setPeopleSort}
                descending={peopleDescending()}
                onDescending={setPeopleDescending}
              />
            </Show>
          </div>
        </Show>
      </ViewShell.Main>
      <Show when={listsEnabled() && editing()}>
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
          onLoad={createCrmExportLoader(
            view.source,
            fetchCrmExportCompanies,
            isCrmCompanyEntity
          )}
        />
      </Show>
      <Show when={importing()}>
        <CrmImport onClose={() => setImporting(false)} />
      </Show>
    </ViewShell.Root>
  );
}
