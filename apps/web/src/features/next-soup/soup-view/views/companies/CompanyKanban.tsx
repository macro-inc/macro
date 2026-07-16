import { NO_STAGE } from '@app/features/next-soup/filters/configs/';
import { EmptyState } from '@app/features/next-soup/soup-view/empty-states';
import { useFilterRefinements } from '@app/features/next-soup/soup-view/filters-bar/use-filter-refinements';
import { SoupEntityContextMenu } from '@app/features/next-soup/soup-view/soup-entity-context-menu';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { usePreviewPaneVisiblity } from '@app/features/next-soup/soup-view/use-preview-pane-visibility';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import { useDealStages } from '@companies/crm/deal-stages';
import { CrmStageIcon } from '@companies/crm/StageIcon';
import {
  useClosedStageIds,
  useCrmPermissions,
  useCrmUnavailable,
} from '@companies/crm/team-crm-config';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { Resize } from '@core/component/Resize';
import { UserIcon } from '@core/component/UserIcon';
import EmptyStatePreviewIcon from '@design/empty-state-doc.svg';
import {
  Entity,
  type EntityData,
  formatTimestamp,
  getCompanyOwnerId,
  isCrmCompanyEntity,
} from '@entity';
import CircleDashed from '@phosphor/circle-dashed.svg';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { createElementSize } from '@solid-primitives/resize-observer';
import { cn, EmptyStatePanel, Layer } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';

/** Column key for companies without a Stage value. */
const NO_STAGE_KEY = '';

/** Minimum column width the snapping layout will shrink to. */
const MIN_COLUMN_WIDTH = 224;
/** gap-3 between columns. */
const COLUMN_GAP = 12;
/** p-3 on each side of the column row. */
const BOARD_PADDING_X = 24;

type StageColumn = {
  key: string;
  label: string;
};

/**
 * Kanban board for the Customers view: one column per active deal stage
 * (team-customized set when present, else the seeded system stages) plus
 * "No stage", fed by the same filtered soup entities as the list. Cards
 * drag between columns to update the company's Stage property (team
 * admins/owners only, matching CRM edit access; moving deals out of a
 * closed stage additionally requires the move-closed-deals permission).
 *
 * Like the list, the board supports the toggleable preview pane (Preview
 * button / space in the filters bar): while it's open, clicking a card
 * previews the company to the side instead of replacing the split.
 */
export function CompanyKanban() {
  const { source, soup, stageFilter, searchText } = useSoupView();
  const panel = useSplitPanelOrThrow();
  const saveMutation = useBulkSaveEntityPropertiesMutation();
  const orchestrator = useGlobalBlockOrchestrator();

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

  const stageColumns = createMemo((): StageColumn[] => {
    // Candidates in canonical pipeline order: the filterable set (active
    // stages plus retired legacy stages on the system default), then
    // "No stage" — checked columns always render in this fixed order.
    const candidates: StageColumn[] = [
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

  const { paneVisible, selectedEntity } = usePreviewPaneVisiblity();

  const companies = createMemo(() => source.data().filter(isCrmCompanyEntity));

  // Mirror the list view's empty states: beyond CRM-unavailable, an empty
  // board ("No customers yet" / no search or filter matches) shows the
  // panel instead of a row of empty columns. Fetches keep the board
  // mounted so the empty state doesn't flash during refetches.
  const showEmptyState = () =>
    crmUnavailable() ||
    (!source.isFetching() && companies().length === 0) ||
    forceEmptyState();

  const columns = createMemo(() => {
    const buckets = new Map<string, EntityData[]>(
      stageColumns().map((column) => [column.key, []])
    );
    for (const company of companies()) {
      const key = resolveStage(company) ?? NO_STAGE_KEY;
      (buckets.get(buckets.has(key) ? key : NO_STAGE_KEY) ?? []).push(company);
    }
    return stageColumns().map((column) => ({
      ...column,
      entities: buckets.get(column.key) ?? [],
    }));
  });

  // A card can be dragged when the user can edit CRM data at all, and its
  // current stage is either open or the user may move closed deals.
  const canDragFrom = (stageKey: string) =>
    canEditCrm() &&
    (stageKey === NO_STAGE_KEY ||
      !closedStageIds().has(stageKey) ||
      canMoveClosedDeals());

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

  const moveToStage = (entityId: string, stageKey: string) => {
    const entity = companies().find((company) => company.id === entityId);
    if (!entity) return;
    const currentStage = resolveStage(entity) ?? NO_STAGE_KEY;
    if (currentStage === stageKey) return;

    saveMutation.mutate({
      properties: [
        {
          entityId,
          entityType: EntityType.COMPANY,
          property: stageProperty(),
          apiValues: {
            valueType: 'SELECT_STRING',
            values: stageKey === NO_STAGE_KEY ? null : [stageKey],
          },
        },
      ],
    });
  };

  const openCompany = (entity: EntityData, event: MouseEvent) => {
    soup.focus.set(entity.id);

    // While the preview pane is open, card clicks retarget it instead of
    // replacing the split (mirrors the list view's behavior).
    if (paneVisible()) {
      soup.setPreviewEntity(entity.id);
      return;
    }

    void openEntityInSplitFromUnifiedList(entity, {
      openInNewSplit: event.shiftKey,
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
      <Resize.Zone direction="horizontal" gutter={0}>
        <Resize.Panel id="company-kanban" minSize={200}>
          {/* Relative wrapper anchors the horizontal scrollbar to the board's
            bottom edge when the split is too narrow for all columns. */}
          <div
            class={cn(
              'relative size-full min-w-0',
              paneVisible() && 'border-r border-edge-muted'
            )}
          >
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
                        'flex h-full min-w-56 flex-1 flex-col rounded-lg border border-edge-muted bg-surface',
                        dropTarget() === column.key &&
                          draggedId() &&
                          'border-accent/50 bg-accent/5'
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
                        if (dropTarget() === column.key)
                          setDropTarget(undefined);
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
                              <SoupEntityContextMenu entity={entity}>
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
        </Resize.Panel>
        <Show when={paneVisible()}>
          <Resize.Panel
            id="soup-preview"
            minSize={500}
            target={{ kind: 'percent', percent: 70 }}
          >
            <Show
              when={selectedEntity()}
              fallback={
                <EmptyStatePanel
                  graphic={EmptyStatePreviewIcon}
                  title="Nothing selected"
                  description="Select a card from the board to preview it here"
                  centered
                />
              }
            >
              {(entity) => (
                <PreviewPanel
                  selectedEntity={entity()}
                  orchestrator={orchestrator}
                  splitPanelContext={panel}
                />
              )}
            </Show>
          </Resize.Panel>
        </Show>
      </Resize.Zone>
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
          'flex flex-col gap-1.5 rounded-lg border border-edge-muted bg-panel p-2.5 text-sm',
          'hover:border-edge hover:bg-active transition-colors',
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
