import { t } from '@app/lib/i18n';
import type { BlockAlias, BlockName } from '@core/block';
import { PopupPreview } from '@core/component/DocumentPreview';
import { HoverCard } from '@core/component/HoverCard';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { itemToBlockName } from '@core/constant/allBlocks';
import { fireAndForget } from '@core/util/fireAndForget';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import Plus from '@icon/system/regular/plus.svg';
import DeleteIcon from '@icon/system/regular/x.svg';
import { Property as PropertyNS, useProperty } from '@property';
import { usePropertiesContext } from '@property/context/PropertiesContext';
import { usePropertyEntityDisplay } from '@property/hooks';
import type { Property } from '@property/types';
import { getEntityValues } from '@property/utils';
import { isAccessiblePreviewItem, useItemPreview } from '@queries/preview';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { Button, CollectionEmptyState, Layer } from '@ui';
import { cn } from '@ui/utils/classname';
import { createSignal, For, type JSX, Show, type Signal } from 'solid-js';
import { createEntityCollectionDropTarget } from './entity-collection-drop';

export function EntityCollectionProperty(props: {
  entityId: string;
  loading?: boolean;
  onRefresh: () => Promise<unknown>;
  property: Property;
  actions: (saving: Signal<boolean>) => JSX.Element;
}) {
  const ctx = usePropertiesContext();
  const saving = createSignal(false);

  return (
    <PropertyNS.Root
      property={props.property}
      canEdit={ctx.canEdit}
      onSave={ctx.saveHandler.saveProperty}
      onRefresh={ctx.onRefresh}
    >
      <EntityCollectionPropertyBody
        entityId={props.entityId}
        loading={props.loading}
        onRefresh={props.onRefresh}
        property={props.property}
        saving={saving}
        actions={props.actions(saving)}
      />
      <PropertyNS.PopoverEditor
        entitySelfFilter={{
          entityType: ctx.entityType,
          blockId: props.entityId,
        }}
      />
    </PropertyNS.Root>
  );
}

function EntityCollectionPropertyBody(props: {
  entityId: string;
  loading?: boolean;
  onRefresh: () => Promise<unknown>;
  property: Property;
  saving: Signal<boolean>;
  actions: JSX.Element;
}) {
  const ctx = usePropertiesContext();
  const propertyCtx = useProperty();
  const entities = () => getEntityValues(props.property);
  const isReadOnly = () => !ctx.canEdit || props.property.isMetadata;
  const [isSaving, setIsSaving] = props.saving;
  const dropTarget = createEntityCollectionDropTarget({
    property: () => props.property,
    selfId: () => props.entityId,
    selfType: () => ctx.entityType,
    disabled: () =>
      Boolean(
        isReadOnly() || props.loading || isSaving() || propertyCtx.editorOpen()
      ),
    onDrop: (reference) => saveReferences([...entities(), reference]),
  });
  const isDraggingOver = () => dropTarget?.isOver() ?? false;
  const handleAdd: JSX.EventHandler<HTMLButtonElement, MouseEvent> = (event) => {
    event.stopPropagation();
    if (isReadOnly() || isSaving()) return;
    propertyCtx.openEditor(event.currentTarget);
  };

  const saveReferences = async (refs: EntityReference[]) => {
    if (isReadOnly() || isSaving()) return;
    setIsSaving(true);
    try {
      await ctx.saveHandler.saveProperty(props.property, {
        valueType: 'ENTITY',
        refs: refs.length > 0 ? refs : null,
      });
      await props.onRefresh();
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveEntity = (entityId: string) =>
    saveReferences(entities().filter((entity) => entity.entity_id !== entityId));

  return (
    <div class="group/property-row min-w-0 py-2">
      <div class="flex items-center justify-between gap-2">
        <span
          class="min-w-0 truncate text-ink-muted"
          title={props.property.displayName}
        >
          {props.property.displayName}
        </span>
        <div class="ml-auto flex shrink-0 items-center">
          <Show when={!isReadOnly() && entities().length > 0}>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              class="text-ink-extra-muted"
              aria-label={`Add ${props.property.displayName}`}
              disabled={isSaving()}
              onClick={handleAdd}
            >
              <Plus class="size-4" />
            </Button>
          </Show>
          {props.actions}
        </div>
      </div>
      <div
        ref={(element) => dropTarget?.ref(element)}
        role="group"
        aria-label={props.property.displayName}
        aria-busy={isSaving()}
        class={cn(
          'mt-2 flex min-h-8 flex-wrap gap-1.5 rounded-lg',
          isDraggingOver() &&
            'bg-accent/5 ring-2 ring-inset ring-accent'
        )}
      >
        <For
          each={entities()}
          fallback={
            <Show when={!props.loading}>
              <CollectionEmptyState
                message={
                  isDraggingOver()
                    ? t('common.dropToAdd')
                    : t('common.emptyCollection')
                }
                action={
                  <Show when={!isReadOnly()}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      class="text-ink-extra-muted"
                      disabled={isSaving()}
                      onClick={handleAdd}
                    >
                      <Plus class="size-4" />
                      {t('common.add')}
                    </Button>
                  </Show>
                }
              />
            </Show>
          }
        >
          {(entityRef) => (
            <NonUserEntityChip
              property={props.property}
              entityId={entityRef.entity_id}
              entityType={entityRef.entity_type}
              specificMessageId={entityRef.specific_message_id}
              canEdit={!isReadOnly() && !isSaving()}
              onRemove={() =>
                fireAndForget(
                  handleRemoveEntity(entityRef.entity_id),
                  'property-collection-remove'
                )
              }
              onEdit={(anchor) => {
                if (isReadOnly() || isSaving()) return;
                propertyCtx.openEditor(anchor);
              }}
            />
          )}
        </For>
      </div>
    </div>
  );
}

export function NonUserEntityChip(props: {
  property: Property;
  entityId: string;
  entityType: EntityType;
  specificMessageId?: string | null;
  canEdit?: boolean;
  onRemove?: () => void;
  onEdit?: (anchor?: HTMLElement) => void;
}) {
  let containerRef: HTMLDivElement | undefined;
  const { name, icon } = usePropertyEntityDisplay(
    () => props.entityId,
    () => props.entityType,
    {
      specificMessageId: () => props.specificMessageId,
    }
  );
  const previewBlockType = () =>
    getDocumentPreviewFallbackBlockType(props.entityType);
  const isDocumentPreviewEntity = () =>
    props.entityType === 'DOCUMENT' || props.entityType === 'TASK';

  const openEditor = (event: MouseEvent) => {
    if (!props.canEdit || !props.onEdit) return;
    event.stopPropagation();
    props.onEdit(containerRef);
  };

  return (
    <Layer depth={2}>
      <div
        ref={containerRef}
        class="inline-flex min-w-0 max-w-full border h-7 items-stretch border-edge-muted rounded-md bg-surface text-ink overflow-clip"
      >
        <Show
          when={isDocumentPreviewEntity()}
          fallback={
            <button
              type="button"
              class="flex min-w-0 max-w-full items-center gap-1.5 px-2 text-left"
              onClick={openEditor}
              disabled={!props.canEdit}
            >
              <span class="shrink-0 flex items-center">{icon()}</span>
              <span class="min-w-0 truncate">{name()}</span>
            </button>
          }
        >
          <DocumentEntityChipButton
            entityId={props.entityId}
            fallbackBlockType={previewBlockType()}
            icon={icon()}
            name={name()}
          />
        </Show>
        <Show when={props.canEdit && props.onRemove}>
          <div class="border-l border-edge-muted" />
          <Button
            variant="ghost"
            type="button"
            size="icon-sm"
            class="flex w-6 p-1 h-full shrink-0 rounded-none text-ink-muted not-disabled:hover:text-failure-ink"
            onClick={(event) => {
              event.stopPropagation();
              props.onRemove?.();
            }}
            aria-label={`Remove ${name()}`}
          >
            <DeleteIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
          </Button>
        </Show>
      </div>
    </Layer>
  );
}

function DocumentEntityChipButton(props: {
  entityId: string;
  fallbackBlockType: BlockName | BlockAlias | undefined;
  icon: JSX.Element;
  name: string;
}) {
  const [item] = useItemPreview(() => ({
    id: props.entityId,
    type: 'document',
  }));
  const blockType = () => {
    const preview = item();
    if (isAccessiblePreviewItem(preview)) {
      return itemToBlockName(preview);
    }
    return props.fallbackBlockType;
  };
  const navHandlers = useSplitNavigationHandler<HTMLButtonElement>((event) => {
    const targetBlockType = blockType();
    if (!targetBlockType) return;
    event.stopPropagation();
    openDocument(targetBlockType, props.entityId, {}, event.shiftKey);
  });

  return (
    <button
      type="button"
      class="flex min-w-0 max-w-full items-center gap-1.5 px-2 text-left"
      {...navHandlers}
    >
      <span class="shrink-0 flex items-center">{props.icon}</span>
      <HoverCard
        trigger={<span class="truncate">{props.name}</span>}
        content={
          <PopupPreview
            mouseEnter={() => {}}
            mouseLeave={() => {}}
            documentInfo={{
              id: props.entityId,
              name: props.name,
              type: blockType() ?? 'unknown',
              params: {},
              isOpenable: true,
            }}
          />
        }
        triggerClass="min-w-0 truncate"
      />
    </button>
  );
}

function getDocumentPreviewFallbackBlockType(
  entityType: EntityType
): BlockName | BlockAlias | undefined {
  if (entityType === 'TASK') return 'task';
  if (entityType === 'DOCUMENT') return undefined;
  return undefined;
}