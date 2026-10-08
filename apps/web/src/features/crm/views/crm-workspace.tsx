import {
  SearchBar,
  useViewControlHotkeys,
  useViewShell,
  ViewShell,
} from '@app/components/view-shell';
import { VIEW_SHELL_TOUR } from '@app/components/view-shell/tour';
import { NIL_UUID } from '@app/features/next-soup/filters/filter-store';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { SoupActiveFiltersBar } from '@app/features/next-soup/soup-view/filters-bar/soup-active-filters-bar';
import { SoupViewContextGroup } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-group';
import { SoupViewContextSort } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-sort';
import { UnifiedFilterDropdown } from '@app/features/next-soup/soup-view/filters-bar/unified-filter-dropdown';
import { useFilterRefinements } from '@app/features/next-soup/soup-view/filters-bar/use-filter-refinements';
import { usePreference } from '@app/preferences/use-preference';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { debounce } from '@core/util/debounce';
import {
  type EntityData,
  isCrmCompanyEntity,
  isCrmContactEntity,
} from '@entity';
import ListIcon from '@phosphor/list.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Button, Dropdown, Tooltip } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import {
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { CrmListDialog } from '../components/company-list-dialog';
import { CrmSidebar } from '../components/crm-sidebar';
import { PipelineDialog } from '../components/pipeline-dialog';
import { PipelineSidebar } from '../components/pipeline-sidebar';
import { useCrmContext } from '../context/crm-context';
import { useCrmWorkspace } from '../context/workspace-context';
import { CRM_RECORDS } from '../core/navigation';
import { createCrmExportLoader } from '../primitives/export-source';
import { useApplyCrmView } from './apply-view';
import { CrmExport } from './export-companies';
import { CrmImport } from './import-companies';
import { PipelineView } from './pipeline';
import { CrmRecordDetail, type CrmRecordRef } from './record-detail';
import { CompanyDisplayMenu, CompanyViewsMenu } from './saved-views-menu';
import {
  useCrmLists,
  useCurrentTeamQuery,
  useQuickAccessCrmCompaniesQuery,
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
                if ((event.target as HTMLElement).closest('nav button'))
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

/** Contacts are not in the search index, so People searches the soup query. */
function PeopleSearchBar() {
  const view = useCrmWorkspace();
  let input: HTMLInputElement | undefined;
  const [text, setText] = createSignal(
    view.queryFilters.state.include.crmContactSearch ?? ''
  );
  // Every applied search restarts the server query; wait for a typing pause.
  const applySearch = debounce(
    (value: string) =>
      view.queryFilters.set({
        include: { crmContactSearch: value.trim() || undefined },
      }),
    250
  );
  onCleanup(applySearch.clear);
  const search = (value: string) => {
    setText(value);
    applySearch(value);
  };
  useViewControlHotkeys({
    scopeId: view.host.scopeId,
    enabled: view.host.isActive,
    search: {
      description: 'Search people',
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
      label="Search people"
      placeholder="Search people"
      value={text()}
      onValueChange={search}
      onEscape={view.host.focus}
      hotkey="cmd+f"
      class="max-w-md flex-1"
    />
  );
}

function CrmFilterChips(props: { onReset: () => void }) {
  const { consolidatedFiltersList } = useFilterRefinements();
  return (
    <SoupActiveFiltersBar
      filters={consolidatedFiltersList()}
      onClearAll={props.onReset}
    />
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
    openCreateContact: openCreateContactModal,
    exportCompanies: fetchCrmExportCompanies,
    PipelineEditor,
    copyViewLink,
  } = useCrmContext();
  const view = useCrmWorkspace();
  const [selectedRecord, setSelectedRecord] = createSignal<CrmRecordRef>();
  const closeRecord = () => setSelectedRecord(undefined);
  const openRecord = (entity: EntityData) => {
    const type = isCrmCompanyEntity(entity)
      ? 'company'
      : isCrmContactEntity(entity)
        ? 'contact'
        : undefined;
    if (!type) return false;
    view.soup.focus.set(entity.id);
    view.host.captureEntryState();
    setSelectedRecord({ type, id: entity.id, name: entity.name });
    return true;
  };
  const apply = useApplyCrmView();
  const [collapsed, setCollapsed] = usePreference(
    'macro:pref:crm:sidebar-collapsed',
    { default: false }
  );
  const teamQuery = useCurrentTeamQuery();
  const teamId = () =>
    teamQuery.isSuccess ? teamQuery.data?.team.id : undefined;
  const pipelinesEnabled = useCrmContext().pipelinesEnabled();
  const canCreatePipeline = () =>
    pipelinesEnabled() &&
    teamQuery.isSuccess &&
    teamQuery.data?.team.crm_enabled === true;
  const pipelines = useCrmContext().createPipelines(() =>
    pipelinesEnabled() ? teamId() : undefined
  );
  const [creatingPipeline, setCreatingPipeline] = createSignal(false);
  const pipelineId = () =>
    pipelinesEnabled() && view.activeTab()?.startsWith('pipeline:')
      ? view.activeTab()?.slice('pipeline:'.length)
      : undefined;
  const activePipeline = () =>
    pipelines.pipelines().find((pipeline) => pipeline.id === pipelineId());
  const selectPipeline = (id: string) => {
    closeRecord();
    view.setActiveTab(`pipeline:${id}`);
  };
  const listsEnabled = useCrmContext().listsEnabled();
  const lists = useCrmLists(() => (listsEnabled() ? teamId() : undefined));
  const [editing, setEditing] = createSignal<{
    id?: string;
    name: string;
    companyIds: string[];
  }>();
  const [importing, setImporting] = createSignal(false);
  const active = () => view.activeTab() ?? 'active';
  const peopleActive = () => active() === 'people';
  const [exporting, setExporting] = createSignal(false);
  const activeList = () =>
    lists.lists().find((list) => `list:${list.id}` === active());
  // Every other tab (hidden companies, saved or shared views) is a company view.
  const activeRecord = () =>
    pipelineId()
      ? `pipeline:${pipelineId()}`
      : active().startsWith('list:') || peopleActive()
        ? active()
        : 'active';
  const title = () =>
    activeList()?.name ??
    CRM_RECORDS.find((record) => record.id === activeRecord())?.label ??
    'Companies';
  const navigate = (id: string) => {
    if (!listsEnabled() && id.startsWith('list:')) id = 'active';
    closeRecord();
    if (id === 'people') {
      // Re-applying would clear a search the People search bar still shows.
      if (peopleActive()) return;
      const people = getViewPreset('companies', 'people');
      apply({
        kind: 'crm',
        activeTab: id,
        filters: people?.filters,
        clientFilters: people?.clientFilters,
      });
      return;
    }
    if (!id.startsWith('list:')) id = 'active';
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
      clientFilters: preset?.clientFilters,
      groupBy: preset?.groupBy,
    });
  };
  onMount(() => {
    if (!listsEnabled() && active().startsWith('list:')) navigate('active');
  });
  const sidebar = () => (
    <CrmSidebar
      pipelines={
        <Show when={pipelinesEnabled()}>
          <PipelineSidebar
            pipelines={pipelines.pipelines()}
            activeId={pipelineId()}
            loading={pipelines.loading()}
            error={pipelines.error()}
            canCreate={canCreatePipeline()}
            onCreate={() => setCreatingPipeline(true)}
            onSelect={selectPipeline}
            onRetry={() => void pipelines.refresh()}
          />
        </Show>
      }
      active={activeRecord()}
      lists={lists.lists().map((list) => ({
        id: list.id,
        name: list.name,
        count: list.config.companyIds.length,
      }))}
      listsEnabled={listsEnabled()}
      listsLoading={lists.query.isLoading}
      listsError={lists.query.isError}
      canCreateList={!!teamId()}
      onNavigate={navigate}
      onCreateCompany={openCreateCompanyModal}
      onCreateContact={() => openCreateContactModal()}
      pipeline={
        pipelinesEnabled()
          ? {
              disabled: !canCreatePipeline(),
              onCreate: () => setCreatingPipeline(true),
            }
          : undefined
      }
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
        <Show when={selectedRecord()} keyed>
          {(record) => (
            <CrmRecordDetail
              record={record}
              viewName={title()}
              onClose={closeRecord}
              navigation={
                <NavigationToggle onExpand={() => setCollapsed(false)}>
                  <Suspense>{sidebar()}</Suspense>
                </NavigationToggle>
              }
            />
          )}
        </Show>
        <Show when={pipelineId()} keyed>
          {(id) => (
            <Show when={activePipeline()}>
              {(pipeline) => (
                <PipelineView
                  pipeline={pipeline()}
                  source={pipelines}
                  Sharing={useCrmContext().PipelineSharing}
                  Editor={PipelineEditor}
                  onCopyLink={() =>
                    copyViewLink({
                      kind: 'crm',
                      activeTab: `pipeline:${id}`,
                    })
                  }
                  onTrashed={() => navigate('active')}
                  navigation={
                    <NavigationToggle onExpand={() => setCollapsed(false)}>
                      <Suspense>{sidebar()}</Suspense>
                    </NavigationToggle>
                  }
                />
              )}
            </Show>
          )}
        </Show>
        <Show when={pipelineId() && !activePipeline()}>
          <div class="flex flex-col items-start gap-3 p-6 text-sm text-ink-muted">
            <p>
              {pipelines.loading()
                ? 'Loading pipeline…'
                : pipelines.error()
                  ? 'Could not load this pipeline.'
                  : 'This pipeline is unavailable or you no longer have access.'}
            </p>
            <Button variant="ghost" onClick={() => navigate('active')}>
              Back to companies
            </Button>
          </div>
        </Show>
        <Show when={!selectedRecord() && !pipelineId()}>
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
            <Show
              when={!peopleActive()}
              fallback={
                <ViewShell.Header>
                  <div class="flex min-w-0 items-center justify-between gap-3">
                    <PeopleSearchBar />
                    <Button
                      variant="outline"
                      class="ml-auto shrink-0"
                      onClick={() => openCreateContactModal()}
                    >
                      <PlusIcon class="size-4" />
                      New contact
                    </Button>
                  </div>
                </ViewShell.Header>
              }
            >
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
                    <Button variant="outline" onClick={openCreateCompanyModal}>
                      <PlusIcon />
                      New company
                    </Button>
                  </div>
                </div>
              </ViewShell.Header>
              <Suspense>
                <CrmFilterChips onReset={() => navigate(active())} />
              </Suspense>
            </Show>
          </Show>
          <div class="flex min-h-0 min-w-0 flex-1 flex-col">
            {props.children({
              onOpenEntity: isTouchDevice() ? undefined : openRecord,
              mobileHeaderLeading: isTouchDevice() ? (
                <NavigationToggle onExpand={() => setCollapsed(false)}>
                  <Suspense>{sidebar()}</Suspense>
                </NavigationToggle>
              ) : undefined,
            })}
          </div>
        </Show>
      </ViewShell.Main>
      <Show when={creatingPipeline() && canCreatePipeline()}>
        <PipelineDialog
          onClose={() => setCreatingPipeline(false)}
          onCreate={async (input) => {
            const pipeline = await pipelines.create(input);
            selectPipeline(pipeline.id);
          }}
        />
      </Show>
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
