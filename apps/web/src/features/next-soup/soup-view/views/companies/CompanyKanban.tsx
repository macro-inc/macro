import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { usePreviewPaneVisiblity } from '@app/features/next-soup/soup-view/use-preview-pane-visibility';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { useDealStages } from '@companies/crm/deal-stages';
import {
  type CrmDisplayOptions,
  useCrmDisplayOptions,
} from '@companies/crm/display-options';
import { CrmStageIcon } from '@companies/crm/StageIcon';
import {
  useClosedStageIds,
  useCrmPermissions,
} from '@companies/crm/team-crm-config';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
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
import { cn, EmptyStatePanel, Layer } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';

/** Column key for companies without a Stage value. */
const NO_STAGE_KEY = '';

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
  const { source, soup } = useSoupView();
  const panel = useSplitPanelOrThrow();
  const saveMutation = useBulkSaveEntityPropertiesMutation();
  const orchestrator = useGlobalBlockOrchestrator();

  const { stages, stageProperty, resolveStage } = useDealStages();
  const { canEditCrm, canMoveClosedDeals } = useCrmPermissions();
  const closedStageIds = useClosedStageIds(stages);
  // Personal display options gate which fields render on cards; read once
  // here and passed down rather than per-card.
  const displayOptions = useCrmDisplayOptions();

  const stageColumns = createMemo((): StageColumn[] => [
    ...stages().map((stage) => ({ key: stage.id, label: stage.label })),
    { key: NO_STAGE_KEY, label: 'No stage' },
  ]);

  const { paneVisible, selectedEntity } = usePreviewPaneVisiblity();

  const companies = createMemo(() => source.data().filter(isCrmCompanyEntity));

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
    <Resize.Zone direction="horizontal" gutter={0}>
      <Resize.Panel id="company-kanban" minSize={200}>
        <div
          class={cn(
            'size-full min-w-0 overflow-x-auto overflow-y-hidden',
            paneVisible() && 'border-r border-edge-muted'
          )}
        >
          <div class="flex h-full gap-3 p-3">
            <For each={columns()}>
              {(column, columnIndex) => (
                <div
                  class={cn(
                    'flex h-full w-64 shrink-0 flex-col rounded-lg border border-edge-muted bg-surface',
                    dropTarget() === column.key &&
                      draggedId() &&
                      'border-accent/50 bg-accent/5'
                  )}
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
                    <span class="ml-auto shrink-0 tabular-nums px-1.5 py-px rounded-full bg-ink/10 text-ink-extra-muted font-medium">
                      {column.entities.length}
                    </span>
                  </div>
                  <div class="min-h-0 flex-1 overflow-y-auto scrollbar-hidden flex flex-col gap-2 px-2 pb-2">
                    <For each={column.entities}>
                      {(entity) => (
                        <CompanyKanbanCard
                          entity={entity}
                          fields={displayOptions.options().kanbanFields}
                          draggable={canDragFrom(column.key)}
                          dragging={draggedId() === entity.id}
                          onDragStart={(e) => {
                            e.dataTransfer?.setData('text/plain', entity.id);
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
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>
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
  );
}

function CompanyKanbanCard(props: {
  entity: EntityData;
  /** Which optional card fields render (personal display options). */
  fields: CrmDisplayOptions['kanbanFields'];
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
          'hover:border-edge transition-colors',
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
          <Show when={props.fields.owner && ownerId()}>
            {(id) => (
              <span class="ml-auto shrink-0">
                <UserIcon id={id()} size="sm" suppressClick />
              </span>
            )}
          </Show>
        </div>
        <Show when={props.fields.domain || props.fields.lastInteraction}>
          <div class="flex items-center gap-2 min-w-0 text-xs text-ink-extra-muted">
            <Show when={props.fields.domain && primaryDomain()}>
              {(domain) => <span class="truncate min-w-0">{domain()}</span>}
            </Show>
            {/* Last interaction — updatedAt carries crm_companies.last_interaction. */}
            <Show when={props.fields.lastInteraction && props.entity.updatedAt}>
              {(ts) => (
                <span class="ml-auto shrink-0">{formatTimestamp(ts())}</span>
              )}
            </Show>
          </div>
        </Show>
      </div>
    </Layer>
  );
}
