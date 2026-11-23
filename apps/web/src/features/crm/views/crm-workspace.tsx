import {
  asideCollapsedPreferenceKey,
  CollectionPanes,
  SearchBar,
  useViewControlHotkeys,
  ViewNavigationControls,
  ViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import {
  ListHeader,
  ListHeaderSearch,
} from '@app/components/view-shell/ListHeader';
import { MobileListLayout } from '@app/components/view-shell/MobileListLayout';
import { useInlinePreviewLayout } from '@app/components/view-shell/use-inline-preview-layout';
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
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { debounce } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type EntityData,
  isCrmCompanyEntity,
  isCrmContactEntity,
} from '@entity';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import FileCsvIcon from '@icon/system/regular/file-csv.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button, ButtonGroup, Tooltip } from '@ui';
import { Result } from 'neverthrow';
import {
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { CrmAccessFallback } from '../components/access-denied';
import { CrmListDialog } from '../components/company-list-dialog';
import { CrmCreateMenu } from '../components/crm-create-menu';
import { CrmMobileTabs } from '../components/crm-mobile-tabs';
import { CrmSidebar } from '../components/crm-sidebar';
import { CrmListError, CrmListSkeleton } from '../components/list-state';
import { PeopleDisplayMenu } from '../components/people-display-menu';
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
import { CrmEmailOptInBanner } from './email-privacy';
import { CrmExport } from './export-companies';
import { CrmImport } from './import-companies';
import { CrmItemDetail } from './item-detail';
import { PipelineView } from './pipeline';
import { CrmRecordDetail } from './record-detail';
import { CompanyDisplayMenu, CompanyViewsMenu } from './saved-views-menu';
import {
  useCrmLists,
  useCurrentTeamQuery,
  useQuickAccessCrmCompaniesQuery,
} from './use-crm';

const CRM_ASIDE_PREFERENCE = 'crm';
/** Where CRM saved a collapsed sidebar before it used the shell's preference. */
const LEGACY_COLLAPSED_PREFERENCE = 'macro:pref:crm:sidebar-collapsed';

/**
 * Moves a choice saved under CRM's old key to the shell's, which wins if set.
 * The old key stays until the copy succeeds; storage that throws leaves the
 * shell's default in place.
 */
const adoptLegacyCollapsedPreference = Result.fromThrowable(() => {
  const legacy = localStorage.getItem(LEGACY_COLLAPSED_PREFERENCE);
  if (legacy === null) return;
  const key = asideCollapsedPreferenceKey(CRM_ASIDE_PREFERENCE);
  if (localStorage.getItem(key) === null) localStorage.setItem(key, legacy);
  localStorage.removeItem(LEGACY_COLLAPSED_PREFERENCE);
});

/**
 * Split close and Show navigation for CRM headers outside a top bar. Touch
 * opens navigation as a sheet from the same pill the list's filter row has.
 */
function CrmNavigationControls() {
  return (
    <Show
      when={!isTouchDevice()}
      fallback={<ViewSidebar.Toggle action="expand" presentation="pill" />}
    >
      <ViewNavigationControls />
    </Show>
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
      focusResults={view.host.focus}
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
    clearPeopleSearch: () => void;
    editList?: () => void;
  }) => JSX.Element;
}) {
  // Before the shell below reads the preference.
  adoptLegacyCollapsedPreference();
  const {
    openCreateCompany: openCreateCompanyModal,
    openCreateContact: openCreateContactModal,
    exportCompanies: fetchCrmExportCompanies,
    PipelineEditor,
    canAccess,
    accessState,
    retryAccess,
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
  const clearPeopleSearch = () => {
    applyPeopleSearch.clear();
    setPeopleSearch('');
    view.queryFilters.set({ include: { crmContactSearch: undefined } });
  };

  const settings = view.host.settings;
  const { openWithSplit } = useCrmContext().createNavigation();
  const records = view.host.record.records;
  const itemKey = () => {
    const item = view.host.record.item();
    return item ? `${item.itemType}:${item.itemId}` : undefined;
  };
  const itemOpen = () => !!itemKey();
  const recordOpen = () => records().length > 0 && !itemOpen();
  const showRecord = (record: CrmRecordRef) => {
    // The list unmounts; its entry keeps the scroll position for the return.
    view.host.captureEntryState();
    view.host.record.open([record]);
  };
  const inlinePreviewLayout = useInlinePreviewLayout();
  const openRecord = (entity: EntityData) => {
    if (accessState() === 'denied') return false;
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
  }) => {
    if (accessState() === 'denied') return;
    if (inlinePreviewLayout()) showRecord({ ...record, name: '' });
    else openWithSplit(record, { activate: true });
  };
  const apply = useApplyCrmView();
  const teamQuery = useCurrentTeamQuery();
  const teamId = () =>
    teamQuery.isSuccess ? teamQuery.data?.team.id : undefined;
  const canCreatePipeline = () =>
    canAccess() && teamQuery.isSuccess && !!teamQuery.data;
  const pipelines = useCrmContext().createPipelines(teamId);
  const [creatingPipeline, setCreatingPipeline] = createSignal(false);
  const pipelineId = () => pipelineIdOfTab(view.activeTab());
  const activePipeline = () =>
    pipelines.pipelines().find((pipeline) => pipeline.id === pipelineId());
  // Another tab's list replaces an open record; the same tab returns to its list.
  const selectPipeline = (id: string) => {
    settings.close();
    if (pipelineTab(id) === view.activeTab()) view.host.record.close();
    else view.setActiveTab(pipelineTab(id));
  };
  const listsFlag = useCrmContext().listsEnabled();
  const listsEnabled = () => canAccess() && listsFlag();
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
    return isCrmActivityTab(tab) ? tab : undefined;
  };
  const [exporting, setExporting] = createSignal(false);
  createEffect(() => {
    if (accessState() !== 'denied') return;
    setEditing(undefined);
    setImporting(false);
    setExporting(false);
    setCreatingPipeline(false);
    settings.close();
  });
  const activeList = () =>
    lists.lists().find((list) => `list:${list.id}` === active());
  const editActiveList = () => {
    const list = activeList();
    if (list)
      setEditing({
        id: list.id,
        name: list.name,
        companyIds: [...list.config.companyIds],
      });
  };
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
    if (!listsFlag() && id.startsWith('list:')) id = 'active';
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
    if (!listsFlag() && active().startsWith('list:')) navigate('active');
    // Saved and shared links to the retired Databases view open Companies.
    if (active() === 'databases') navigate('active');
  });
  const toolbarCreateMenu = () => (
    <CrmCreateMenu
      presentation="toolbar"
      onCreateCompany={openCreateCompanyModal}
      onCreateContact={() => openCreateContactModal()}
      pipeline={{
        disabled: !canCreatePipeline(),
        onCreate: () => setCreatingPipeline(true),
      }}
    />
  );
  const mobileHeader = () => (
    <div class="flex min-w-0 flex-col gap-2">
      <div class="flex min-w-0 items-center gap-2">
        <CrmMobileTabs
          canAccess={accessState() !== 'denied'}
          active={activeRecord()}
          pipelines={pipelines.pipelines()}
          lists={listsEnabled() ? lists.lists() : []}
          onNavigate={(id) => {
            const pipeline = pipelineIdOfTab(id);
            if (pipeline) selectPipeline(pipeline);
            else navigate(id);
          }}
          leading={<ViewSidebar.Toggle action="expand" presentation="pill" />}
        />
        <Show
          when={
            canAccess() && !peopleActive() && !pipelineId() && !activityTab()
          }
        >
          <Suspense>
            <MobileFilterDrawer />
          </Suspense>
        </Show>
      </div>

      <Show
        when={canAccess() && !peopleActive() && !pipelineId() && !activityTab()}
      >
        <Suspense>
          <SoupFiltersBar />
        </Suspense>
      </Show>
      <Show when={canAccess() && !pipelineId() && !activityTab()}>
        <div class="flex min-w-0 items-center justify-between gap-3">
          <Show when={peopleActive()}>
            <PeopleSearchBar
              value={peopleSearch()}
              onValueChange={searchPeople}
            />
          </Show>
          <PeopleDisplayMenu visibility={view.peopleVisibility} />
          <Show when={peopleActive()}>
            <Button
              variant="secondary"
              class="ml-auto shrink-0"
              onClick={() => openCreateContactModal()}
            >
              <PlusIcon class="size-4" />
              New contact
            </Button>
          </Show>
        </div>
      </Show>
    </div>
  );
  return (
    <ViewShell.Root
      contentLayout="collection"
      asidePreferenceKey={CRM_ASIDE_PREFERENCE}
      aside={{ preserveDuringResize: false }}
      main={{ min: 320 }}
      resizable
    >
      <ViewShell.Aside>
        <Suspense fallback={<CrmListSkeleton label="Loading CRM" />}>
          <CrmSidebar
            canAccess={accessState() !== 'denied'}
            promotion={
              <ConnectorImportSidebar
                category="crm"
                class="mt-auto"
                // Its CSV import opens a dialog that waits for proven access.
                applies={
                  canAccess() && teamQuery.isSuccess ? !!teamId() : undefined
                }
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
            // A tool pressed before access is proven would open once it is.
            canCreateList={canAccess() && !!teamId()}
            onNavigate={navigate}
            onCreateCompany={openCreateCompanyModal}
            onCreateContact={() => openCreateContactModal()}
            pipeline={{
              disabled: !canCreatePipeline(),
              onCreate: () => setCreatingPipeline(true),
            }}
            onNewList={() => setEditing({ name: '', companyIds: [] })}
            onImport={() => setImporting(true)}
            onExport={() => setExporting(true)}
            onSettings={settings.open}
          />
        </Suspense>
      </ViewShell.Aside>
      <CollectionPanes
        hasDetail={settings.isOpen() || recordOpen() || itemOpen()}
        list={
          <>
            <Show when={canAccess()}>
              <Suspense>
                <CrmEmailOptInBanner />
              </Suspense>
            </Show>
            <MobileListLayout header={mobileHeader()}>
              <Show
                when={canAccess() || !!pipelineId()}
                fallback={
                  <>
                    <Show when={!isTouchDevice()}>
                      <ViewShell.Header>
                        <CrmNavigationControls />
                      </ViewShell.Header>
                    </Show>
                    <CrmAccessFallback
                      state={accessState()}
                      onRetry={retryAccess}
                    />
                  </>
                }
              >
                <Show when={pipelineId()} keyed>
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
                          navigation={<CrmNavigationControls />}
                        />
                      )}
                    </Show>
                  )}
                </Show>
                <Show when={pipelineId() && !activePipeline()}>
                  <Show
                    when={!pipelines.loading()}
                    fallback={<CrmListSkeleton label="Loading pipeline" />}
                  >
                    <CrmListError
                      title={
                        pipelines.error()
                          ? 'Could not load this pipeline.'
                          : 'This pipeline is unavailable or you no longer have access.'
                      }
                      onRetry={() => pipelines.refresh()}
                    />
                    <Show
                      when={accessState() !== 'denied'}
                      fallback={
                        <ViewSidebar.Toggle
                          action="expand"
                          presentation="pill"
                        />
                      }
                    >
                      <Button
                        variant="ghost"
                        onClick={() => navigate('active')}
                      >
                        Back to companies
                      </Button>
                    </Show>
                  </Show>
                </Show>
                <Show when={!pipelineId() && activityTab()} keyed>
                  {(tab) => (
                    <Suspense
                      fallback={
                        <CrmListSkeleton label="Loading CRM activity" />
                      }
                    >
                      <CrmActivityView
                        tab={tab}
                        title={
                          <ViewSidebar.Title caret={false} title={title()}>
                            {title()}
                          </ViewSidebar.Title>
                        }
                      />
                    </Suspense>
                  )}
                </Show>
                <Show when={!pipelineId() && !activityTab()}>
                  <Show when={!isTouchDevice()}>
                    <ListHeader
                      title={
                        <ViewSidebar.Title caret={false} title={title()}>
                          {title()}
                        </ViewSidebar.Title>
                      }
                    >
                      <Show when={!peopleActive()}>
                        <HeaderActionGroup label="Company filters" size="md">
                          <UnifiedFilterDropdown
                            grouped
                            hideLabel
                            variant="ghost"
                          />
                        </HeaderActionGroup>
                        <HeaderActionGroup
                          label="Company view options"
                          size="md"
                        >
                          <SoupViewContextSort grouped />
                          <SoupViewContextGroup
                            grouped
                            hideLabel
                            variant="ghost"
                          />
                          <CompanyDisplayMenu grouped />
                          <Suspense>
                            <CompanyViewsMenu grouped hideLabel />
                          </Suspense>
                          <Show when={listsEnabled() && activeList()}>
                            <ButtonGroup.Button
                              variant="ghost"
                              onClick={editActiveList}
                            >
                              Edit list
                            </ButtonGroup.Button>
                          </Show>
                        </HeaderActionGroup>
                      </Show>
                      <PeopleDisplayMenu visibility={view.peopleVisibility} />
                      {toolbarCreateMenu()}
                      <CrmHeaderSearch
                        label={
                          peopleActive() ? 'Search people' : 'Search companies'
                        }
                        value={
                          peopleActive() ? peopleSearch() : view.searchText()
                        }
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
                  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
                    {props.children({
                      onOpenEntity: inlinePreviewLayout()
                        ? openRecord
                        : undefined,
                      clearPeopleSearch,
                      editList: activeList() ? editActiveList : undefined,
                    })}
                  </div>
                </Show>
              </Show>
            </MobileListLayout>
          </>
        }
      >
        <Show
          when={canAccess() && (!isTouchDevice() || !inlinePreviewLayout())}
        >
          <Suspense>
            <CrmEmailOptInBanner />
          </Suspense>
        </Show>
        <Show
          when={!settings.isOpen()}
          fallback={
            <>
              <div class="flex h-12 min-w-0 shrink-0 items-center gap-3 px-4 touch:h-auto touch:min-h-12 touch:pt-[calc(var(--mobile-content-inset-top,var(--safe-top,0px))+0.5rem)] touch:pb-2">
                <CrmNavigationControls />
                <Tooltip label="Back">
                  <Button
                    aria-label="Close settings"
                    tooltip="Close settings"
                    variant="ghost"
                    size="icon-sm"
                    onClick={settings.close}
                  >
                    <ArrowLeftIcon class="size-4" />
                  </Button>
                </Tooltip>
                <ViewSidebar.Title caret={false} class="h-7 flex-1">
                  Settings
                </ViewSidebar.Title>
              </div>
              {/* The header above already clears the status bar on touch. */}
              <div class="min-h-0 min-w-0 flex-1 [--mobile-content-inset-top:0px]">
                <CrmSettings />
              </div>
            </>
          }
        >
          <Show
            when={canAccess() || (!!pipelineId() && !recordOpen())}
            fallback={
              <>
                <ViewShell.Header>
                  <Show
                    when={isTouchDevice()}
                    fallback={<CrmNavigationControls />}
                  >
                    {mobileHeader()}
                  </Show>
                </ViewShell.Header>
                <CrmAccessFallback
                  state={accessState()}
                  onRetry={retryAccess}
                />
              </>
            }
          >
            <Show when={itemKey()} keyed>
              <CrmItemDetail sourceName={activePipeline()?.name ?? title()} />
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
                navigation={<CrmNavigationControls />}
              />
            </Show>
          </Show>
        </Show>
      </CollectionPanes>
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
                if (accessState() !== 'denied') navigate(`list:${id}`);
              }}
              onDelete={
                initial().id
                  ? async () => {
                      await lists.remove.mutateAsync(initial().id!);
                      if (accessState() !== 'denied') navigate('active');
                    }
                  : undefined
              }
            />
          );
        }}
      </Show>
      <Show when={canAccess() && exporting()}>
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
      <Show when={canAccess() && importing()}>
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
