import { t } from '@app/lib/i18n';
import type { BlockAlias, BlockName } from '@core/block';
import { PopupPreview } from '@core/component/DocumentPreview';
import { HoverCard } from '@core/component/HoverCard';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { itemToBlockName } from '@core/constant/allBlocks';
import { fireAndForget } from '@core/util/fireAndForget';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import Plus from '@icon/system/regular/plus.svg';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import DropIcon from '@icon/system/regular/tray-arrow-down.svg';
import DeleteIcon from '@icon/system/regular/x.svg';
import { Property as PropertyNS, useProperty } from '@property';
import { usePropertiesContext } from '@property/context/PropertiesContext';
import { usePropertyEntityDisplay } from '@property/hooks';
import type { Property, PropertyApiValues } from '@property/types';
import { getEntityValues } from '@property/utils';
import { isAccessiblePreviewItem, useItemPreview } from '@queries/preview';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { Button, Layer } from '@ui';
import { cn } from '@ui/utils/classname';
import { batch, createSignal, For, type JSX, Show, type Signal } from 'solid-js';
import { createEntityCollectionDropTarget } from './entity-collection-drop';

type PendingEntityReference = EntityReference & { displayName?: string };
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
  const [pendingReferences, setPendingReferences] =
    createSignal<PendingEntityReference[]>([]);
  const [pendingRemovals, setPendingRemovals] = createSignal<EntityReference[]>([]);
  const saveProperty = async (
    property: Property,
    values: PropertyApiValues,
    displayName?: string
  ) => {
    if (!ctx.canEdit || property.isMetadata || props.loading || isSaving()) return;
    const currentRefs = getEntityValues(property);
    const nextRefs = values.valueType === 'ENTITY' ? (values.refs ?? []) : [];
    batch(() => {
      setPendingReferences(
        nextRefs
          .filter((reference) =>
            !currentRefs.some((current) =>
              current.entity_id === reference.entity_id &&
              current.entity_type === reference.entity_type
            )
          )
          .map((reference) => ({ ...reference, displayName }))
      );
      setPendingRemovals(
        currentRefs.filter((reference) =>
          !nextRefs.some((next) =>
            next.entity_id === reference.entity_id &&
            next.entity_type === reference.entity_type
          )
        )
      );
      setIsSaving(true);
    });
    try {
      await ctx.saveHandler.saveProperty(property, values);
      await props.onRefresh();
    } finally {
      batch(() => {
        setPendingReferences([]);
        setPendingRemovals([]);
        setIsSaving(false);
      });
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
        pendingReferences={pendingReferences()}
        pendingRemovals={pendingRemovals()}
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
  pendingReferences: PendingEntityReference[];
  pendingRemovals: EntityReference[];
  onSave: (
    property: Property,
    values: PropertyApiValues,
    displayName?: string
  ) => Promise<void>;
  property: Property;
  saving: Signal<boolean>;
  actions: JSX.Element;
}) {
  const ctx = usePropertiesContext();
  const propertyCtx = useProperty();
  const entities = () => getEntityValues(props.property);
  const pendingReference = (reference: EntityReference) =>
    props.pendingReferences.find((pending) =>
      pending.entity_id === reference.entity_id &&
      pending.entity_type === reference.entity_type
    );
  const isPending = (reference: EntityReference) =>
    Boolean(pendingReference(reference));
  const isPendingRemoval = (reference: EntityReference) =>
    props.pendingRemovals.some((removed) =>
      removed.entity_id === reference.entity_id &&
      removed.entity_type === reference.entity_type
    );
  const displayedEntities = () => [
    ...entities().filter(
      (reference) => !isPending(reference) && !isPendingRemoval(reference)
    ),
    ...props.pendingReferences,
  ];
  const hasItems = () => displayedEntities().length > 0;
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
    onDrop: (reference, name) => saveReferences([...entities(), reference], name),
  });
  const isDraggingOver = () => dropTarget?.isOver() ?? false;
  const canDrop = () => dropTarget?.canDrop() ?? false;
  const isDragging = () => dropTarget?.isDragging() ?? false;
  const showDropZone = () => isDraggingOver();
  const handleAdd: JSX.EventHandler<HTMLButtonElement, MouseEvent> = (event) => {
    event.stopPropagation();
    if (isReadOnly() || props.loading || isSaving()) return;
    propertyCtx.openEditor(event.currentTarget);
  };

  const saveReferences = (refs: EntityReference[], displayName?: string) =>
    props.onSave(
      props.property,
      {
        valueType: 'ENTITY',
        refs: refs.length > 0 ? refs : null,
      },
      displayName
    );

  const handleRemoveEntity = (entityId: string) =>
    saveReferences(entities().filter((entity) => entity.entity_id !== entityId));

  return (
    <div
      ref={(element) => dropTarget?.ref(element)}
      role="group"
      aria-label={props.property.displayName}
      class={cn(
        'group/property-row grid min-h-7 min-w-0 items-center gap-x-3',
        hasItems()
          ? 'grid-cols-[minmax(0,1fr)_auto]'
          : 'grid-cols-[minmax(var(--sidepanel-label-width,auto),max-content)_minmax(max-content,1fr)]'
      )}
    >
      <span
        class={cn(
          'flex min-w-0 items-center gap-1.5 transition-colors duration-150 motion-reduce:transition-none',
          canDrop() ? 'text-accent' : 'text-ink-muted'
        )}
        title={props.property.displayName}
      >
        <span class="min-w-0 truncate">{props.property.displayName}</span>
        <Show when={canDrop()}>
          <DropIcon
            class="size-3.5 shrink-0"
            aria-hidden="true"
            data-icon-motion="none"
          />
        </Show>
      </span>
      <div class="flex min-w-0 items-center">
        <Show when={!isReadOnly()}>
          <Button
            type="button"
            variant="ghost"
            size={hasItems() ? 'icon-xs' : 'xs'}
            class={cn(
              'text-ink-extra-muted not-data-disabled:focus-visible:text-ink',
              hasItems() && 'ml-auto',
              isDragging() && 'invisible'
            )}
            aria-label={`Add ${props.property.displayName}`}
            tooltip={hasItems() ? `Add ${props.property.displayName}` : undefined}
            disabled={props.loading || isSaving() || isDragging()}
            onClick={handleAdd}
          >
            <Plus class="size-4" />
            <Show when={!hasItems()}>{t('common.add')}</Show>
          </Button>
        </Show>
        <div
          class={cn('flex shrink-0 items-center', !hasItems() && 'ml-auto')}
        >
          {props.actions}
        </div>
      </div>
      <div class="col-span-2 min-w-0">
        <div
          class={cn(
            'flex flex-wrap gap-1.5 rounded-lg transition-colors duration-300 motion-reduce:transition-none',
            hasItems() && 'mt-1 outline-1 outline-dashed outline-offset-2',
            hasItems() && showDropZone()
              ? 'bg-accent/10 outline-accent'
              : 'outline-transparent'
          )}
          aria-busy={isSaving()}
        >
          <For each={displayedEntities()}>
            {(entityRef) => (
              <NonUserEntityChip
                property={props.property}
                entityId={entityRef.entity_id}
                entityType={entityRef.entity_type}
                specificMessageId={entityRef.specific_message_id}
                pending={isPending(entityRef)}
                pendingLabel={pendingReference(entityRef)?.displayName}
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
          {props.pendingReferences.length > 0 ? t('common.addingItem') : ''}
        </span>
        <Show when={!hasItems()}>
          <div
            aria-hidden={!showDropZone()}
            class={cn(
              'grid transition-all duration-300 ease-out motion-reduce:transition-none',
              showDropZone()
                ? 'grid-rows-[1fr] opacity-100'
                : 'grid-rows-[0fr] opacity-0'
            )}
          >
            <div class="min-h-0 overflow-hidden">
              <div class="mt-1 flex h-12 items-center justify-center gap-2 rounded-lg border border-dashed border-accent bg-accent/10 text-xs text-accent">
                <DropIcon
                  class="size-4 shrink-0"
                  aria-hidden="true"
                  data-icon-motion="none"
                />
                <span>{t('common.dropToAdd')}</span>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}

export function NonUserEntityChip(props: {
  property: Property;
  entityId: string;
  entityType: EntityType;
  specificMessageId?: string | null;
  pending?: boolean;
  canEdit?: boolean;
  pendingLabel?: string;
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
        aria-busy={props.pending || undefined}
      >
        <Show
          when={!props.pending}
          fallback={
            <span class="flex min-w-0 items-center gap-1.5 px-2 text-ink-muted">
              <span class="shrink-0 flex items-center">{icon()}</span>
              <span class="min-w-0 truncate">{props.pendingLabel ?? name()}</span>
              <SpinnerIcon
                class="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            </span>
          }
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