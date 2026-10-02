import { resolveEntityActionViewContext } from '@app/features/next-soup/actions';
import { NO_STAGE } from '@app/features/next-soup/filters/configs/';
import { EmptyState } from '@app/features/next-soup/soup-view/empty-states';
import { useFilterRefinements } from '@app/features/next-soup/soup-view/filters-bar/use-filter-refinements';
import { SoupEntityContextMenu } from '@app/features/soup';
import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { UserIcon } from '@core/component/UserIcon';
import {
  Entity,
  type EntityData,
  formatTimestamp,
  getCompanyOwnerId,
  isCrmCompanyEntity,
} from '@entity';
import CircleDashed from '@phosphor/circle-dashed.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { cn, Layer } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { CrmStageIcon } from '../components/stage-icon';
import { useCrmContext } from '../context/crm-context';
import { useCrmWorkspace } from '../context/workspace-context';
import { createCompanyBoard } from '../primitives/company-board';
import { CrmEmptyState } from './empty-state';
import {
  useBulkSaveEntityPropertiesMutation,
  useClosedStageIds,
  useCrmPermissions,
  useCrmUnavailable,
  useDealStages,
} from './use-crm';

/** Column key for companies without a Stage value. */
const NO_STAGE_KEY = '';

/** Minimum column width the snapping layout will shrink to. */
const MIN_COLUMN_WIDTH = 224;
/** gap-3 between columns. */
const COLUMN_GAP = 12;
/** p-3 on each side of the column row. */
const BOARD_PADDING_X = 24;

/**
 * Kanban board for the Customers view: one column per active deal stage
 * (team-customized set when present, else the seeded system stages) plus
 * "No stage", fed by the same filtered soup entities as the list. Cards
 * drag between columns to update the company's Stage property (team
 * admins/owners only, matching CRM edit access; moving deals out of a
 * closed stage additionally requires the move-closed-deals permission).
 *
 */
export function CompanyKanban(props: {
  onOpenEntity?: (entity: EntityData) => boolean;
}) {
  const { source, soup, stageFilter, searchText, activeTab, host } =
    useCrmWorkspace();
  const entityActionViewContext = () =>
    resolveEntityActionViewContext({
      activeListView: 'companies',
      activeTab: activeTab(),
    });

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

  // Search results don't carry properties, which would strand every match
  // in "No stage" (and skip closed-stage drag gating). Backfill from the
  // normalized soup cache, which still holds the full rows the search is
  // narrowing.
  const companies = createMemo(() =>
    source.data().filter(isCrmCompanyEntity).map(useCrmContext().hydrateCompany)
  );

  // Mirror the list view's empty states: beyond CRM-unavailable, an empty
  // board ("No customers yet" / no search or filter matches) shows the
  // panel instead of a row of empty columns. Fetches keep the board
  // mounted so the empty state doesn't flash during refetches.
  const showEmptyState = () =>
    crmUnavailable() ||
    (!source.isFetching() && companies().length === 0) ||
    forceEmptyState();

  const saveMutation = useBulkSaveEntityPropertiesMutation();
  const { columns, stageColumns, canDragFrom, moveToStage } =
    createCompanyBoard<import('@entity').CrmCompanyEntity>({
      companies,
      stages,
      filterStages,
      selectedStages: stageFilter,
      noStageFilter: NO_STAGE,
      resolveStage,
      canEdit: canEditCrm,
      canMoveClosed: canMoveClosedDeals,
      closedStages: closedStageIds,
      saveStage: (entityId, stageKey, onError) =>
        void saveMutation
          .mutateAsync({
            properties: [
              {
                entityId,
                entityType: 'COMPANY',
                property: stageProperty(),
                apiValues: {
                  valueType: 'SELECT_STRING',
                  values: stageKey === NO_STAGE_KEY ? null : [stageKey],
                },
              },
            ],
          })
          .catch(onError),
    });

  const [draggedId, setDraggedId] = createSignal<string>();
  const [dropTarget, setDropTarget] = createSignal<string>();
  const [scrollRef, setScrollRef] = createSignal<HTMLDivElement>();

  // Columns snap to a whole-column layout: as many columns as fit at the
  // minimum width, each widened to exactly fill the viewport. Growing the
  // board snaps in the next column once there's room; the rest scroll.
  const boardSize = createElementSize(scrollRef);
  const columnWidth = createMemo(() => {
    const width = boardSize.width;
    const count = stageColumns().length;
    if (!width || count === 0) return undefined;
    const usable = width - BOARD_PADDING_X;
    const fit = Math.max(
      1,
      Math.min(
        count,
        Math.floor((usable + COLUMN_GAP) / (MIN_COLUMN_WIDTH + COLUMN_GAP))
      )
    );
    // Floored so rounding can't overflow the viewport by a pixel and
    // phantom-trigger the horizontal scrollbar.
    return Math.floor((usable - (fit - 1) * COLUMN_GAP) / fit);
  });

  const openCompany = (entity: EntityData, event: MouseEvent) => {
    if (
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey &&
      props.onOpenEntity?.(entity)
    )
      return;
    soup.focus.set(entity.id);

    host.openCompany(entity, event.shiftKey);
  };

  return (
    <Show
      when={!showEmptyState()}
      fallback={
        <EmptyState
          content={<CrmEmptyState />}
          search={!!searchText()}
          hasRefinementsFromBase={hasActiveRefinements()}
          hasHiddenItems={hasHiddenItems()}
          onClearFilters={resetToTabDefaults}
        />
      }
    >
      {/* Relative wrapper anchors the horizontal scrollbar to the board's
          bottom edge when the split is too narrow for all columns. */}
      <div class="relative size-full min-w-0">
        <div
          ref={setScrollRef}
          class="size-full overflow-x-auto overflow-y-hidden scrollbar-hidden"
        >
          <div class="flex h-full gap-3 p-3">
            <For each={columns()}>
              {(column, columnIndex) => (
                <div
                  class={cn(
                    // Fallback sizing until the board is measured; after
                    // that the snapping columnWidth() takes over.
                    'flex h-full min-w-56 flex-1 flex-col rounded-xl bg-surface-2/30 transition-colors',
                    dropTarget() === column.key && draggedId() && 'bg-accent/10'
                  )}
                  style={
                    columnWidth() !== undefined
                      ? { width: `${columnWidth()}px`, flex: 'none' }
                      : undefined
                  }
                  onDragOver={(e) => {
                    if (!draggedId()) return;
                    e.preventDefault();
                    setDropTarget(column.key);
                  }}
                  onDragLeave={(e) => {
                    if (
                      e.relatedTarget instanceof Node &&
                      e.currentTarget.contains(e.relatedTarget)
                    ) {
                      return;
                    }
                    if (dropTarget() === column.key) setDropTarget(undefined);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id =
                      draggedId() ?? e.dataTransfer?.getData('text/plain');
                    setDropTarget(undefined);
                    setDraggedId(undefined);
                    if (id) moveToStage(id, column.key);
                  }}
                >
                  <div class="flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-ink-muted">
                    <Show
                      when={column.key !== NO_STAGE_KEY}
                      fallback={
                        <CircleDashed class="size-3.5 text-ink-extra-muted" />
                      }
                    >
                      <CrmStageIcon
                        optionId={column.key}
                        index={columnIndex()}
                        class="size-3.5"
                      />
                    </Show>
                    <span class="truncate">{column.label}</span>
                  </div>
                  <div class="min-h-0 flex-1 overflow-y-auto scrollbar-hidden flex flex-col gap-2 px-2 pb-2">
                    <For each={column.entities}>
                      {(entity) => (
                        // The context-menu trigger is h-full (sized for list
                        // rows); an auto-height wrapper resolves that to the
                        // card's content height instead of the column's.
                        <div class="shrink-0">
                          <SoupEntityContextMenu
                            entity={entity}
                            list={soup}
                            selectedEntities={soup.selection.selected}
                            viewContext={entityActionViewContext()}
                          >
                            <CompanyKanbanCard
                              entity={entity}
                              draggable={canDragFrom(column.key)}
                              dragging={draggedId() === entity.id}
                              onDragStart={(e) => {
                                e.dataTransfer?.setData(
                                  'text/plain',
                                  entity.id
                                );
                                if (e.dataTransfer) {
                                  e.dataTransfer.effectAllowed = 'move';
                                }
                                setDraggedId(entity.id);
                              }}
                              onDragEnd={() => {
                                setDraggedId(undefined);
                                setDropTarget(undefined);
                              }}
                              onClick={(e) => openCompany(entity, e)}
                            />
                          </SoupEntityContextMenu>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
        {/* watchContent: columns mount after the initial measurement, so
              overflow must be re-detected as they load in. */}
        <CustomScrollbar
          scrollContainer={scrollRef}
          horizontal
          revealZone={48}
          gutterSize={20}
          watchContent
        />
      </div>
    </Show>
  );
}

function CompanyKanbanCard(props: {
  entity: EntityData;
  draggable: boolean;
  dragging: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
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
        draggable={props.draggable}
        onDragStart={props.onDragStart}
        onDragEnd={props.onDragEnd}
        onClick={props.onClick}
        class={cn(
          'flex flex-col gap-1.5 rounded-lg bg-surface p-2.5 text-sm shadow-sm',
          'hover:bg-hover hover:shadow-md transition-[background-color,box-shadow]',
          props.dragging && 'opacity-40'
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
