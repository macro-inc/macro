import { resolveEntityActionViewContext } from '@app/features/next-soup/actions';
import { NO_STAGE } from '@app/features/next-soup/filters/configs/';
import { EmptyState } from '@app/features/next-soup/soup-view/empty-states';
import { useFilterRefinements } from '@app/features/next-soup/soup-view/filters-bar/use-filter-refinements';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import {
  openEntityInSplitFromUnifiedList,
  preventDuplicatePreviewEntityOpen,
} from '@app/features/next-soup/utils';
import { SoupEntityContextMenu } from '@app/features/soup';
import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import { useDealStages } from '@companies/crm/deal-stages';
import { CrmStageIcon } from '@companies/crm/StageIcon';
import {
  useClosedStageIds,
  useCrmPermissions,
  useCrmUnavailable,
} from '@companies/crm/team-crm-config';
import {
  PipelineBoard,
  type PipelineCardHandle,
  type PipelineColumn,
} from '@components/app/PipelineBoard';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { UserIcon } from '@core/component/UserIcon';
import {
  type CrmCompanyEntity,
  Entity,
  type EntityData,
  formatTimestamp,
  getCompanyOwnerId,
  isCrmCompanyEntity,
} from '@entity';
import CircleDashed from '@phosphor/circle-dashed.svg';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { getSoupEntityById } from '@queries/soup/normalized-cache';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { cn, Layer } from '@ui';
import { createMemo, Show } from 'solid-js';

/** Column key for companies without a Stage value. */
const NO_STAGE_KEY = '';

/**
 * Kanban board for the Customers view: one column per active deal stage
 * (team-customized set when present, else the seeded system stages) plus
 * "No stage", fed by the same filtered soup entities as the list. Cards
 * drag between columns to update the company's Stage property (team
 * admins/owners only, matching CRM edit access; moving deals out of a
 * closed stage additionally requires the move-closed-deals permission).
 *
 * The board itself is the generic `PipelineBoard`; this component supplies
 * the deal-stage columns, the company rows, the CRM drag gating and the
 * Stage property write.
 */
export function CompanyKanban() {
  const { source, soup, stageFilter, searchText, activeTab } = useSoupView();
  const panel = useSplitPanelOrThrow();
  const entityActionViewContext = () =>
    resolveEntityActionViewContext({
      activeListView: panel.handle.content().id,
      activeTab: activeTab(),
    });

  const saveMutation = useBulkSaveEntityPropertiesMutation();

  const { stages, filterStages, stageProperty, resolveStage } = useDealStages();
  const { canEditCrm, canMoveClosedDeals } = useCrmPermissions();
  const closedStageIds = useClosedStageIds(stages);

  // Mirror the list view's no-team / CRM-disabled empty states.
  const crmUnavailable = useCrmUnavailable();
  const { hasActiveRefinements, hasHiddenItems, resetToTabDefaults } =
    useFilterRefinements();

  // Debug: force the board to render its empty state regardless of content.
  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );

  const stageColumns = createMemo((): PipelineColumn[] => {
    // Candidates in canonical pipeline order: the filterable set (active
    // stages plus retired legacy stages on the system default), then
    // "No stage" — checked columns always render in this fixed order.
    const candidates: PipelineColumn[] = [
      ...filterStages().map((stage) => ({ key: stage.id, label: stage.label })),
      { key: NO_STAGE_KEY, label: 'No stage' },
    ];
    // An active stage filter removes the filtered-out columns entirely,
    // not just their (already predicate-filtered) cards. With no filter,
    // only the active stage set shows (legacy stages are opt-in).
    const filter = stageFilter();
    if (filter.length === 0) {
      const active = new Set(stages().map((stage) => stage.id));
      return candidates.filter(
        (column) => column.key === NO_STAGE_KEY || active.has(column.key)
      );
    }
    return candidates.filter((column) =>
      filter.includes(column.key === NO_STAGE_KEY ? NO_STAGE : column.key)
    );
  });

  // Search results don't carry properties, which would strand every match
  // in "No stage" (and skip closed-stage drag gating). Backfill from the
  // normalized soup cache, which still holds the full rows the search is
  // narrowing.
  const companies = createMemo(() =>
    source
      .data()
      .filter(isCrmCompanyEntity)
      .map((entity) => {
        if (entity.properties) return entity;
        const cached = getSoupEntityById(entity.id);
        return cached?.tag === 'crmCompany'
          ? { ...entity, properties: cached.data.properties }
          : entity;
      })
  );

  // Mirror the list view's empty states: beyond CRM-unavailable, an empty
  // board ("No customers yet" / no search or filter matches) shows the
  // panel instead of a row of empty columns. Fetches keep the board
  // mounted so the empty state doesn't flash during refetches.
  const showEmptyState = () =>
    crmUnavailable() ||
    (!source.isFetching() && companies().length === 0) ||
    forceEmptyState();

  // A card can be dragged when the user can edit CRM data at all, and its
  // current stage is either open or the user may move closed deals.
  const canDragFrom = (stageKey: string) =>
    canEditCrm() &&
    (stageKey === NO_STAGE_KEY ||
      !closedStageIds().has(stageKey) ||
      canMoveClosedDeals());

  const moveToStage = (company: CrmCompanyEntity, stageKey: string) =>
    saveMutation.mutateAsync({
      properties: [
        {
          entityId: company.id,
          entityType: EntityType.COMPANY,
          property: stageProperty(),
          apiValues: {
            valueType: 'SELECT_STRING',
            values: stageKey === NO_STAGE_KEY ? null : [stageKey],
          },
        },
      ],
    });

  const openCompany = (entity: EntityData, event: MouseEvent) => {
    // Shift+click always opens a fresh split; opt+click replaces the whole
    // Preview Pair; a plain click while engaged as a Controller previews into
    // the Viewer and shouldn't re-open an entity already shown elsewhere.
    // Matches the list view's onEntityClick.
    if (
      !event.shiftKey &&
      !event.altKey &&
      panel.handle.isControllerSplit() &&
      preventDuplicatePreviewEntityOpen(entity, panel.handle)
    ) {
      return;
    }
    soup.focus.set(entity.id);

    void openEntityInSplitFromUnifiedList(entity, {
      openInNewSplit: event.shiftKey,
      replacePreview: !event.shiftKey && event.altKey,
      splitHandle: panel.handle,
      referredFrom: 'companies',
    });
  };

  return (
    <Show
      when={!showEmptyState()}
      fallback={
        <EmptyState
          listView="companies"
          search={!!searchText()}
          hasRefinementsFromBase={hasActiveRefinements()}
          hasHiddenItems={hasHiddenItems()}
          onClearFilters={resetToTabDefaults}
        />
      }
    >
      <PipelineBoard
        columns={stageColumns()}
        items={companies()}
        itemKey={(company) => company.id}
        itemColumn={(company) => resolveStage(company) ?? NO_STAGE_KEY}
        emptyKey={NO_STAGE_KEY}
        canDragFrom={canDragFrom}
        onMove={moveToStage}
        columnIcon={(column, index) => (
          <Show
            when={column.key !== NO_STAGE_KEY}
            fallback={<CircleDashed class="size-3.5 text-ink-extra-muted" />}
          >
            <CrmStageIcon
              optionId={column.key}
              index={index}
              class="size-3.5"
            />
          </Show>
        )}
        card={(entity, handle) => (
          <SoupEntityContextMenu
            entity={entity}
            list={soup}
            selectedEntities={soup.selection.selected}
            viewContext={entityActionViewContext()}
          >
            <CompanyKanbanCard
              entity={entity}
              handle={handle}
              onClick={(e) => openCompany(entity, e)}
            />
          </SoupEntityContextMenu>
        )}
      />
    </Show>
  );
}

function CompanyKanbanCard(props: {
  entity: EntityData;
  handle: PipelineCardHandle;
  onClick: (e: MouseEvent) => void;
}) {
  const ownerId = () =>
    isCrmCompanyEntity(props.entity)
      ? getCompanyOwnerId(props.entity)
      : undefined;
  const primaryDomain = () =>
    isCrmCompanyEntity(props.entity)
      ? props.entity.domains[0]?.domain
      : undefined;

  return (
    <Layer depth={2}>
      <div
        draggable={props.handle.draggable}
        onDragStart={props.handle.onDragStart}
        onDragEnd={props.handle.onDragEnd}
        onClick={props.onClick}
        class={cn(
          'flex flex-col gap-1.5 rounded-lg border border-edge-muted bg-panel p-2.5 text-sm',
          'hover:border-edge hover:bg-active transition-colors',
          props.handle.dragging && 'opacity-40'
        )}
      >
        <div class="flex items-center gap-2 min-w-0">
          <div class="size-4 shrink-0">
            <Entity.Icon entity={props.entity} />
          </div>
          <span class="ph-no-capture truncate font-semibold min-w-0">
            <Entity.Title entity={props.entity} />
          </span>
          <Show when={ownerId()}>
            {(id) => (
              <span class="ml-auto shrink-0">
                <UserIcon id={id()} size="sm" suppressClick />
              </span>
            )}
          </Show>
        </div>
        <div class="flex items-center gap-2 min-w-0 text-xs text-ink-extra-muted">
          <Show when={primaryDomain()}>
            {(domain) => <span class="truncate min-w-0">{domain()}</span>}
          </Show>
          {/* Last interaction — updatedAt carries crm_companies.last_interaction. */}
          <Show when={props.entity.updatedAt}>
            {(ts) => (
              <span class="ml-auto shrink-0">{formatTimestamp(ts())}</span>
            )}
          </Show>
        </div>
      </div>
    </Layer>
  );
}
