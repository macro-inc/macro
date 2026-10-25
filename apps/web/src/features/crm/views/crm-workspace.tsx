import {
  SearchBar,
  useViewControlHotkeys,
  useViewShell,
  ViewShell,
} from '@app/components/view-shell';
import {
  ListHeader,
  ListHeaderSearch,
} from '@app/components/view-shell/ListHeader';
import { VIEW_SHELL_TOUR } from '@app/components/view-shell/tour';
import { ConnectorImportSidebar } from '@app/features/connector-import/connector-import';
import { NIL_UUID } from '@app/features/next-soup/filters/filter-store';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { MobileFilterDrawer } from '@app/features/next-soup/soup-view/filters-bar/mobile-filter-drawer';
import { SoupActiveFiltersBar } from '@app/features/next-soup/soup-view/filters-bar/soup-active-filters-bar';
import { SoupFiltersBar } from '@app/features/next-soup/soup-view/filters-bar/soup-filters-bar';
import { SoupViewContextGroup } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-group';
import { SoupViewContextSort } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-sort';
import { UnifiedFilterDropdown } from '@app/features/next-soup/soup-view/filters-bar/unified-filter-dropdown';
import { useFilterRefinements } from '@app/features/next-soup/soup-view/filters-bar/use-filter-refinements';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { usePreference } from '@app/preferences/use-preference';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { SplitPanel } from '@components/app/split-panel';
import { enableCrmActivity } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { debounce } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type EntityData,
  isCrmCompanyEntity,
  isCrmContactEntity,
} from '@entity';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import FileCsvIcon from '@phosphor/file-csv.svg';
import ListIcon from '@phosphor/list.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Button, Dropdown, Tooltip } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import {
  createEffect,
  createSignal,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { CrmListDialog } from '../components/company-list-dialog';
import { CrmCreateMenu } from '../components/crm-create-menu';
import { CrmMobileTabs } from '../components/crm-mobile-tabs';
import { CrmSidebar } from '../components/crm-sidebar';
import { PipelineDialog } from '../components/pipeline-dialog';
import { PipelineSidebar } from '../components/pipeline-sidebar';
import { useCrmContext } from '../context/crm-context';
import { useCrmWorkspace } from '../context/workspace-context';
import {
  CRM_ACTIVITY_TABS,
  CRM_RECORDS,
  isCrmActivityTab,
  pipelineIdOfTab,
  pipelineTab,
} from '../core/navigation';
import type { CrmRecordRef } from '../core/record';
import { createCrmExportLoader } from '../primitives/export-source';
import { CrmActivityView } from './activity';
import { useApplyCrmView } from './apply-view';
import { Crm as CrmSettings } from './crm-settings';
import { CrmExport } from './export-companies';
import { CrmImport } from './import-companies';
import { PipelineView } from './pipeline';
import { CrmRecordDetail } from './record-detail';
import { CompanyDisplayMenu, CompanyViewsMenu } from './saved-views-menu';
import {
  useCrmLists,
  useCurrentTeamQuery,
  useQuickAccessCrmCompaniesQuery,
} from './use-crm';

function NavigationToggle(props: {
  onExpand: () => void;
  children: JSX.Element;
}) {
  const shell = useViewShell();
  const [open, setOpen] = createSignal(false);
  // CRM collapses its own sidebar, so its toggle stands in for the shell's.
  const toggleTarget = tourTarget(VIEW_SHELL_TOUR.sidebarToggle);
  return (
    <Show when={!isTouchDevice() && shell.aside.isCollapsed()}>
      <SplitPanel.ControlGroup>
        <SplitPanel.CloseButton />
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
          <Dropdown
            open={open()}
            onOpenChange={setOpen}
            placement="bottom-start"
          >
            <Tooltip label="Show CRM navigation">
              <Dropdown.Trigger
                variant="ghost"
                size="icon-sm"
                aria-label="Show CRM navigation"
                ref={toggleTarget}
              >
                <ListIcon class="size-4" />
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
      </SplitPanel.ControlGroup>
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
function PeopleSearchBar(props: {
  value: string;
  onValueChange: (value: string) => void;
}) {
  const view = useCrmWorkspace();
  let input: HTMLInputElement | undefined;
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
      value={props.value}
      onValueChange={props.onValueChange}
      onEscape={view.host.focus}
      hotkey="cmd+f"
      class="max-w-md flex-1"
    />
  );
}

function CrmHeaderSearch(props: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const view = useCrmWorkspace();
  let focusSearch: (() => void) | undefined;
  useViewControlHotkeys({
    scopeId: view.host.scopeId,
    enabled: view.host.isActive,
    search: {
      description: props.label,
      run: () => {
        focusSearch?.();
        return true;
      },
    },
  });
  return (
    <ListHeaderSearch
      label={props.label}
      value={props.value}
      onValueChange={props.onValueChange}
      onEscape={view.host.focus}
      registerFocus={(focus) => (focusSearch = focus)}
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
  }) => JSX.Element;
}) {
  const activityFlag = useFeatureFlag(enableCrmActivity);
  const {
    openCreateCompany: openCreateCompanyModal,
    openCreateContact: openCreateContactModal,
    exportCompanies: fetchCrmExportCompanies,
    PipelineEditor,
    copyPipelineLink,
  } = useCrmContext();
  const view = useCrmWorkspace();
  const [peopleSearch, setPeopleSearch] = createSignal(
    view.queryFilters.state.include.crmContactSearch ?? ''
  );
  const applyPeopleSearch = debounce(
    (value: string) =>
      view.queryFilters.set({
        include: { crmContactSearch: value.trim() || undefined },
      }),
    250
  );
  onCleanup(applyPeopleSearch.clear);
  const searchPeople = (value: string) => {
    setPeopleSearch(value);
    applyPeopleSearch(value);
  };

  const settings = view.host.settings;
  const { openWithSplit } = useCrmContext().createNavigation();
  const records = view.host.record.records;
  const recordOpen = () => records().length > 0;
  const showRecord = (record: CrmRecordRef) => {
    // The list unmounts; its entry keeps the scroll position for the return.
    view.host.captureEntryState();
    view.host.record.open([record]);
  };
  const openRecord = (entity: EntityData) => {
    const type = isCrmCompanyEntity(entity)
      ? 'company'
      : isCrmContactEntity(entity)
        ? 'contact'
        : undefined;
    if (!type) return false;
    view.soup.focus.set(entity.id);
    showRecord({ type, id: entity.id, name: entity.name });
    return true;
  };
  // Touch shows records in their own split, as the lists do.
  const openPipelineRecord = (record: {
    type: 'company' | 'contact';
    id: string;
  }) =>
    isTouchDevice()
      ? openWithSplit(record, { activate: true })
      : showRecord({ ...record, name: '' });
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
    pipelinesEnabled() ? pipelineIdOfTab(view.activeTab()) : undefined;
  const activePipeline = () =>
    pipelines.pipelines().find((pipeline) => pipeline.id === pipelineId());
  // Another tab's list replaces an open record; the same tab returns to its list.
  const selectPipeline = (id: string) => {
    settings.close();
    if (pipelineTab(id) === view.activeTab()) view.host.record.close();
    else view.setActiveTab(pipelineTab(id));
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
  const activityTab = () => {
    const tab = active();
    return activityFlag().enabled && isCrmActivityTab(tab) ? tab : undefined;
  };
  const activityPending = () =>
    isCrmActivityTab(active()) && activityFlag().loading;
  const [exporting, setExporting] = createSignal(false);
  const activeList = () =>
    lists.lists().find((list) => `list:${list.id}` === active());
  // A list tab from the URL has no preset, so apply its company filter once the list loads.
  createEffect(() => {
    const list = activeList();
    if (!list) return;
    const expected = list.config.companyIds.length
      ? list.config.companyIds
      : [NIL_UUID];
    const current = view.queryFilters.state.include.crmCompanyId;
    if (
      current?.length === expected.length &&
      current.every((id, index) => id === expected[index])
    )
      return;
    const preset = getViewPreset('companies');
    const filters = structuredClone(preset?.filters ?? {});
    filters.include = {
      ...filters.include,
      crmCompanyId: expected,
    };
    view.queryFilters.replace(filters);
  });
  // Every other tab (hidden companies, saved or shared views) is a company view.
  const activeRecord = () => {
    const id = pipelineId();
    if (id) return pipelineTab(id);
    return active().startsWith('list:') || peopleActive() || activityTab()
      ? active()
      : 'active';
  };
  const title = () =>
    activeList()?.name ??
    [...CRM_RECORDS, ...CRM_ACTIVITY_TABS].find(
      (record) => record.id === activeRecord()
    )?.label ??
    'Companies';
  const navigate = (id: string) => {
    settings.close();
    if (!listsEnabled() && id.startsWith('list:')) id = 'active';
    if (!activityFlag().enabled && isCrmActivityTab(id)) id = 'active';
    if (id !== 'people' && !id.startsWith('list:') && !isCrmActivityTab(id))
      id = 'active';
    if (id === active()) view.host.record.close();
    if (isCrmActivityTab(id)) {
      view.setActiveTab(id);
      return;
    }
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
  const toolbarCreateMenu = () => (
    <CrmCreateMenu
      presentation="toolbar"
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
    />
  );
  // Keep cold activity links intact until PostHog resolves; off falls back to Companies.
  createEffect(
    on(
      () => [activityFlag().loading, activityFlag().enabled, active()] as const,
      ([loading, enabled, tab]) => {
        if (!loading && !enabled && isCrmActivityTab(tab)) navigate('active');
      }
    )
  );
  const sidebar = (onCollapse?: () => void) => (
    <CrmSidebar
      searchLabel={peopleActive() ? 'Search people' : 'Search companies'}
      search={() => (
        <Show when={peopleActive()} fallback={<CrmSearchBar />}>
          <PeopleSearchBar
            value={peopleSearch()}
            onValueChange={searchPeople}
          />
        </Show>
      )}
      promotion={
        <ConnectorImportSidebar
          category="crm"
          class="mt-auto"
          applies={teamQuery.isSuccess ? !!teamId() : undefined}
          alternatives={[
            {
              icon: FileCsvIcon,
              label: 'Upload a CSV',
              description: 'Import companies from a spreadsheet export.',
              onSelect: () => setImporting(true),
            },
          ]}
        />
      }
      pipelines={
        <Show when={pipelinesEnabled()}>
          <PipelineSidebar
            pipelines={pipelines.pipelines()}
            activeId={settings.isOpen() ? undefined : pipelineId()}
            loading={pipelines.loading()}
            error={pipelines.error()}
            canCreate={canCreatePipeline()}
            onCreate={() => setCreatingPipeline(true)}
            onSelect={selectPipeline}
            onRetry={() => fireAndForget(pipelines.refresh(), 'crm')}
          />
        </Show>
      }
      active={settings.isOpen() ? 'settings' : activeRecord()}
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
      onSettings={settings.open}
      onCollapse={onCollapse}
    />
  );
  return (
    <ViewShell.Root aside={collapsed() ? false : {}} main={{ min: 320 }}>
      <ViewShell.Aside>
        <Suspense
          fallback={<div class="p-4 text-sm text-ink-muted">Loading CRM…</div>}
        >
          {sidebar(() => setCollapsed(true))}
        </Suspense>
      </ViewShell.Aside>
      <ViewShell.Main>
        <Show
          when={!settings.isOpen()}
          fallback={
            <>
              <div class="flex h-12 min-w-0 shrink-0 items-center gap-3 px-4 touch:h-auto touch:min-h-12 touch:pt-[calc(var(--mobile-content-inset-top,var(--safe-top,0px))+0.5rem)] touch:pb-2">
                <NavigationToggle onExpand={() => setCollapsed(false)}>
                  <Suspense>{sidebar()}</Suspense>
                </NavigationToggle>
                <Tooltip label="Back">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    label="Close CRM settings"
                    onClick={settings.close}
                  >
                    <ArrowLeftIcon class="size-4" />
                  </Button>
                </Tooltip>
                <h1 class="flex h-7 min-w-0 flex-1 items-center text-sm font-semibold tracking-[-0.03em]">
                  <span class="truncate">CRM settings</span>
                </h1>
              </div>
              {/* The header above already clears the status bar on touch. */}
              <div class="min-h-0 min-w-0 flex-1 [--mobile-content-inset-top:0px]">
                <CrmSettings />
              </div>
            </>
          }
        >
          <Show when={isTouchDevice() && !recordOpen()}>
            <ViewShell.Header>
              <CrmMobileTabs
                active={activeRecord()}
                pipelines={pipelinesEnabled() ? pipelines.pipelines() : []}
                lists={listsEnabled() ? lists.lists() : []}
                onNavigate={(id) => {
                  const pipeline = pipelineIdOfTab(id);
                  if (pipeline) selectPipeline(pipeline);
                  else navigate(id);
                }}
                leading={
                  <Show
                    when={!peopleActive() && !pipelineId() && !activityTab()}
                  >
                    <Suspense>
                      <MobileFilterDrawer />
                    </Suspense>
                  </Show>
                }
              />
            </ViewShell.Header>
            <Show when={!peopleActive() && !pipelineId() && !activityTab()}>
              <Suspense>
                <SoupFiltersBar />
              </Suspense>
            </Show>
          </Show>
          <Show when={recordOpen()}>
            <CrmRecordDetail
              records={records()}
              section={view.host.record.section()}
              commentTarget={view.host.record.commentTarget()}
              viewName={activePipeline()?.name ?? title()}
              onOpen={view.host.record.open}
              onSectionChange={view.host.record.setSection}
              onClose={view.host.record.close}
              onOpenPipeline={selectPipeline}
              navigation={
                <NavigationToggle onExpand={() => setCollapsed(false)}>
                  <Suspense>{sidebar()}</Suspense>
                </NavigationToggle>
              }
            />
          </Show>
          <Show when={!recordOpen() && pipelineId()} keyed>
            {(id) => (
              <Show when={activePipeline()}>
                {(pipeline) => (
                  <PipelineView
                    pipeline={pipeline()}
                    source={pipelines}
                    transfer={{
                      source: useCrmContext().createPipelineTransfer(
                        pipeline()
                      ),
                      downloadCsv: useCrmContext().downloadCsv,
                    }}
                    Sharing={useCrmContext().PipelineSharing}
                    Editor={PipelineEditor}
                    onCopyLink={() => copyPipelineLink(id)}
                    onTrashed={() => navigate('active')}
                    onOpenRecord={openPipelineRecord}
                    navigation={
                      <Show when={!isTouchDevice()}>
                        <NavigationToggle onExpand={() => setCollapsed(false)}>
                          <Suspense>{sidebar()}</Suspense>
                        </NavigationToggle>
                      </Show>
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
          <Show when={!recordOpen() && !pipelineId() && activityPending()}>
            <div class="p-4 text-sm text-ink-muted">Loading CRM activity…</div>
          </Show>
          <Show when={!recordOpen() && !pipelineId() && activityTab()} keyed>
            {(tab) => (
              <>
                <Show when={!isTouchDevice()}>
                  <ListHeader
                    title={
                      <div class="flex min-w-0 items-center gap-3">
                        <NavigationToggle onExpand={() => setCollapsed(false)}>
                          <Suspense>{sidebar()}</Suspense>
                        </NavigationToggle>
                        <h1
                          class="min-w-0 truncate text-sm font-semibold"
                          title={title()}
                        >
                          {title()}
                        </h1>
                      </div>
                    }
                  />
                </Show>
                <Suspense
                  fallback={
                    <div class="p-4 text-sm text-ink-muted">
                      Loading CRM activity…
                    </div>
                  }
                >
                  <CrmActivityView tab={tab} />
                </Suspense>
              </>
            )}
          </Show>
          <Show
            when={
              !recordOpen() &&
              !pipelineId() &&
              !activityTab() &&
              !activityPending()
            }
          >
            <Show
              when={!isTouchDevice()}
              fallback={
                <Show when={peopleActive()}>
                  <ViewShell.Header class="touch:pt-0">
                    <div class="flex min-w-0 items-center justify-between gap-3">
                      <PeopleSearchBar
                        value={peopleSearch()}
                        onValueChange={searchPeople}
                      />
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
                </Show>
              }
            >
              <ListHeader
                title={
                  <div class="flex min-w-0 items-center gap-3">
                    <NavigationToggle onExpand={() => setCollapsed(false)}>
                      <Suspense>{sidebar()}</Suspense>
                    </NavigationToggle>
                    <h1
                      class="min-w-0 truncate text-sm font-semibold"
                      title={title()}
                    >
                      {title()}
                    </h1>
                  </div>
                }
              >
                <Show when={!peopleActive()}>
                  <HeaderActionGroup label="Company filters">
                    <UnifiedFilterDropdown hideLabel variant="ghost" />
                  </HeaderActionGroup>
                  <HeaderActionGroup label="Company view options">
                    <SoupViewContextSort />
                    <SoupViewContextGroup hideLabel variant="ghost" />
                    <CompanyDisplayMenu />
                    <Suspense>
                      <CompanyViewsMenu hideLabel />
                    </Suspense>
                    <Show when={listsEnabled() && activeList()}>
                      {(list) => (
                        <Button
                          variant="ghost"
                          size="md"
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
                  </HeaderActionGroup>
                </Show>
                {toolbarCreateMenu()}
                <CrmHeaderSearch
                  label={peopleActive() ? 'Search people' : 'Search companies'}
                  value={peopleActive() ? peopleSearch() : view.searchText()}
                  onValueChange={(value) =>
                    peopleActive()
                      ? searchPeople(value)
                      : view.setSearchText(value)
                  }
                />
              </ListHeader>
              <Show when={!peopleActive()}>
                <Suspense>
                  <CrmFilterChips onReset={() => navigate(active())} />
                </Suspense>
              </Show>
            </Show>
            {/* The header above already clears the status bar on touch. */}
            <div class="flex min-h-0 min-w-0 flex-1 flex-col [--mobile-content-inset-top:0px]">
              {props.children({
                onOpenEntity: isTouchDevice() ? undefined : openRecord,
              })}
            </div>
          </Show>
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
        <CrmImport
          onClose={() => setImporting(false)}
          pipelines={
            canCreatePipeline()
              ? {
                  existing: () =>
                    pipelines
                      .pipelines()
                      .filter(
                        (pipeline) =>
                          pipeline.recordType === 'company' &&
                          (pipeline.grant === 'owner' ||
                            pipeline.grant === 'edit')
                      ),
                  create: (name, sharing) =>
                    pipelines.create({
                      name,
                      recordType: 'company',
                      sharing,
                    }),
                  transfer: useCrmContext().createPipelineTransfer,
                }
              : undefined
          }
          onOpenPipeline={(id) => {
            setImporting(false);
            selectPipeline(id);
          }}
        />
      </Show>
    </ViewShell.Root>
  );
}
