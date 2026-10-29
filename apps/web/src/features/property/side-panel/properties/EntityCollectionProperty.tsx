import { t } from '@app/lib/i18n';
import type { BlockAlias, BlockName } from '@core/block';
import { PopupPreview } from '@core/component/DocumentPreview';
import { HoverCard } from '@core/component/HoverCard';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { itemToBlockName } from '@core/constant/allBlocks';
import { fireAndForget } from '@core/util/fireAndForget';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import ArrowDownIcon from '@icon/system/regular/arrow-down.svg';
import Plus from '@icon/system/regular/plus.svg';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import DeleteIcon from '@icon/system/regular/x.svg';
import { Property as PropertyNS, useProperty } from '@property';
import { CollectionEmptyState } from '@property/component/CollectionEmptyState';
import {
  type PropertySaveHandler,
  usePropertiesContext,
} from '@property/context/PropertiesContext';
import { usePropertyEntityDisplay } from '@property/hooks';
import type { Property } from '@property/types';
import { getEntityValues } from '@property/utils';
import { isAccessiblePreviewItem, useItemPreview } from '@queries/preview';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { Button, Layer } from '@ui';
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
  const [isSaving, setIsSaving] = saving;
  const [isAdding, setIsAdding] = createSignal(false);
  const saveProperty: PropertySaveHandler['saveProperty'] = async (
    property,
    values
  ) => {
    if (!ctx.canEdit || property.isMetadata || props.loading || isSaving()) return;
    const currentRefs = getEntityValues(property);
    setIsAdding(
      values.valueType === 'ENTITY' &&
        Boolean(
          values.refs?.some((reference) =>
            !currentRefs.some((current) =>
              current.entity_id === reference.entity_id &&
              current.entity_type === reference.entity_type
            )
          )
        )
    );
    setIsSaving(true);
    try {
      await ctx.saveHandler.saveProperty(property, values);
      await props.onRefresh();
    } finally {
      setIsAdding(false);
      setIsSaving(false);
    }
  };

  return (
    <PropertyNS.Root
      property={props.property}
      canEdit={ctx.canEdit}
      onSave={saveProperty}
    >
      <EntityCollectionPropertyBody
        entityId={props.entityId}
        loading={props.loading}
        adding={isAdding()}
        onSave={saveProperty}
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
  adding: boolean;
  onSave: PropertySaveHandler['saveProperty'];
  property: Property;
  saving: Signal<boolean>;
  actions: JSX.Element;
}) {
  const ctx = usePropertiesContext();
  const propertyCtx = useProperty();
  const entities = () => getEntityValues(props.property);
  const isReadOnly = () => !ctx.canEdit || props.property.isMetadata;
  const [isSaving] = props.saving;
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
  const canDrop = () => dropTarget?.canDrop() ?? false;
  const dropZoneHeight = () => (entities().length > 0 ? 'h-18' : 'h-16');
  const showDropZone = () => canDrop() || props.adding;
  const handleAdd: JSX.EventHandler<HTMLButtonElement, MouseEvent> = (event) => {
    event.stopPropagation();
    if (isReadOnly() || props.loading || isSaving()) return;
    propertyCtx.openEditor(event.currentTarget);
  };

  const saveReferences = (refs: EntityReference[]) =>
    props.onSave(props.property, {
      valueType: 'ENTITY',
      refs: refs.length > 0 ? refs : null,
    });

  const handleRemoveEntity = (entityId: string) =>
    saveReferences(entities().filter((entity) => entity.entity_id !== entityId));

  return (
    <div class="group/property-row grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
      <span
        class="min-w-0 truncate text-ink-muted"
        title={props.property.displayName}
      >
        {props.property.displayName}
      </span>
      <div class="ml-auto flex shrink-0 items-center">
        <Show when={!isReadOnly()}>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            class="text-ink-extra-muted"
            aria-label={`Add ${props.property.displayName}`}
            disabled={props.loading || isSaving()}
            onClick={handleAdd}
          >
            <Plus class="size-4" />
          </Button>
        </Show>
        {props.actions}
      </div>
      <div
        ref={(element) => dropTarget?.ref(element)}
        role="group"
        aria-label={props.property.displayName}
        class="col-span-2 mt-1 min-w-0"
      >
        <div class="flex flex-wrap gap-1.5" aria-busy={isSaving()}>
          <For
            each={entities()}
            fallback={
              <Show when={!props.loading && !showDropZone()}>
                <CollectionEmptyState message={t('common.emptyCollection')} />
              </Show>
            }
          >
            {(entityRef) => (
              <NonUserEntityChip
                property={props.property}
                entityId={entityRef.entity_id}
                entityType={entityRef.entity_type}
                specificMessageId={entityRef.specific_message_id}
                canEdit={!isReadOnly() && !props.loading && !isSaving()}
                onRemove={() =>
                  fireAndForget(
                    handleRemoveEntity(entityRef.entity_id),
                    'property-collection-remove'
                  )
                }
                onEdit={(anchor) => {
                  if (isReadOnly() || props.loading || isSaving()) return;
                  propertyCtx.openEditor(anchor);
                }}
              />
            )}
          </For>
        </div>
        <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {props.adding ? t('common.addingItem') : ''}
        </span>
        <div
          aria-hidden={!showDropZone()}
          class={cn(
            'overflow-hidden transition-all duration-150 ease-out motion-reduce:transition-none',
            showDropZone() ? `${dropZoneHeight()} opacity-100` : 'h-0 opacity-0'
          )}
        >
          <div
            class={cn(
              'flex h-16 items-center justify-center gap-2 rounded-lg border text-xs',
              entities().length > 0 && 'mt-2',
              props.adding && 'border-edge-muted bg-surface text-ink-muted',
              !props.adding && 'border-dashed text-accent',
              !props.adding && isDraggingOver() && 'border-accent bg-accent/10',
              !props.adding && !isDraggingOver() && 'border-accent/40 bg-accent/5'
            )}
          >
            <Show
              when={props.adding}
              fallback={<ArrowDownIcon class="size-4 shrink-0" aria-hidden="true" />}
            >
              <SpinnerIcon
                class="size-4 shrink-0 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            </Show>
            <span aria-hidden={props.adding}>
              {props.adding ? t('common.addingItem') : t('common.dropToAdd')}
            </span>
          </div>
        </div>
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