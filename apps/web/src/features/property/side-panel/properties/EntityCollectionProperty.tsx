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
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
  type Signal,
} from 'solid-js';
import { createEntityCollectionDropTarget } from './entity-collection-drop';

type PendingEntityReference = EntityReference & { displayName?: string };

function sameEntityReference(left: EntityReference, right: EntityReference) {
  return (
    left.entity_id === right.entity_id &&
    left.entity_type === right.entity_type &&
    (left.specific_message_id ?? null) === (right.specific_message_id ?? null)
  );
}

export function EntityCollectionProperty(props: {
  entityId: string;
  loading?: boolean;
  onRefresh: () => Promise<unknown>;
  property: Property;
  onSave: (property: Property, values: PropertyApiValues) => Promise<void>;
  saving: Signal<boolean>;
  children: JSX.Element;
}) {
  const ctx = usePropertiesContext();
  const [isSaving, setIsSaving] = props.saving;
  const [confirmedReferences, setConfirmedReferences] =
    createSignal<EntityReference[]>();
  const displayedProperty = createMemo(() => {
    const property = props.property;
    const confirmed = confirmedReferences();
    if (property.valueType !== 'ENTITY' || !confirmed) return property;
    return { ...property, value: confirmed };
  });

  // Retire confirmed edits only after refresh, not during another optimistic save.
  createEffect(() => {
    if (isSaving()) return;
    const confirmed = confirmedReferences();
    if (!confirmed) return;
    const current = getEntityValues(props.property);
    if (current.length !== confirmed.length) return;
    const unmatched = [...current];
    for (const reference of confirmed) {
      const index = unmatched.findIndex((value) =>
        sameEntityReference(value, reference)
      );
      if (index < 0) return;
      unmatched.splice(index, 1);
    }
    setConfirmedReferences(undefined);
  });

  const [pendingReferences, setPendingReferences] = createSignal<
    PendingEntityReference[]
  >([]);
  const [pendingRemovals, setPendingRemovals] = createSignal<EntityReference[]>(
    []
  );
  const saveProperty = async (
    property: Property,
    values: PropertyApiValues,
    displayName?: string
  ) => {
    if (!ctx.canEdit || property.isMetadata || props.loading || isSaving())
      return;
    const currentRefs = getEntityValues(property);
    const nextRefs = values.valueType === 'ENTITY' ? (values.refs ?? []) : [];
    batch(() => {
      setPendingReferences(
        nextRefs
          .filter(
            (reference) =>
              !currentRefs.some((current) =>
                sameEntityReference(current, reference)
              )
          )
          .map((reference) => ({ ...reference, displayName }))
      );
      setPendingRemovals(
        currentRefs.filter(
          (reference) =>
            !nextRefs.some((next) => sameEntityReference(next, reference))
        )
      );
      setIsSaving(true);
    });
    try {
      await props.onSave(property, values);
      setConfirmedReferences(nextRefs);
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
      property={displayedProperty()}
      canEdit={ctx.canEdit}
      onSave={saveProperty}
    >
      <EntityCollectionPropertyBody
        entityId={props.entityId}
        loading={props.loading}
        pendingReferences={pendingReferences()}
        pendingRemovals={pendingRemovals()}
        onSave={saveProperty}
        property={displayedProperty()}
        saving={props.saving}
      >
        {props.children}
      </EntityCollectionPropertyBody>
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
  children: JSX.Element;
}) {
  const ctx = usePropertiesContext();
  const propertyCtx = useProperty();
  const entities = () => getEntityValues(props.property);
  const pendingReference = (reference: EntityReference) =>
    props.pendingReferences.find((pending) =>
      sameEntityReference(pending, reference)
    );
  const isPending = (reference: EntityReference) =>
    Boolean(pendingReference(reference));
  const isPendingRemoval = (reference: EntityReference) =>
    props.pendingRemovals.some((removed) =>
      sameEntityReference(removed, reference)
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
    onDrop: (reference, name) =>
      saveReferences([...entities(), reference], name),
  });
  const isDraggingOver = () => dropTarget?.isOver() ?? false;
  const canDrop = () => dropTarget?.canDrop() ?? false;
  const isDragging = () => dropTarget?.isDragging() ?? false;
  const showDropZone = () => isDraggingOver();
  const handleAdd: JSX.EventHandler<HTMLButtonElement, MouseEvent> = (
    event
  ) => {
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

  const handleRemoveEntity = (reference: EntityReference) =>
    saveReferences(
      entities().filter((entity) => !sameEntityReference(entity, reference))
    );

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
            tooltip={
              hasItems() ? `Add ${props.property.displayName}` : undefined
            }
            disabled={props.loading || isSaving() || isDragging()}
            onClick={handleAdd}
          >
            <Plus class="size-4" />
            <Show when={!hasItems()}>{t('common.add')}</Show>
          </Button>
        </Show>
        <div class={cn('flex shrink-0 items-center', !hasItems() && 'ml-auto')}>
          {props.children}
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
                    handleRemoveEntity(entityRef),
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
        <span
          class="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
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
    <Layer depth={3}>
      <div
        ref={containerRef}
        class="group/collection-item relative inline-flex min-w-0 max-w-full border h-7 items-stretch border-edge-muted rounded-md bg-surface text-ink overflow-clip"
        aria-busy={props.pending || undefined}
      >
        <Show
          when={!props.pending}
          fallback={
            <span class="flex min-w-0 items-center gap-1.5 px-2 text-ink-muted">
              <span class="shrink-0 flex items-center">{icon()}</span>
              <span class="min-w-0 truncate">
                {props.pendingLabel ?? name()}
              </span>
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
            <div class="absolute inset-y-0 right-0 flex border-l border-edge-muted bg-surface pointer-events-none opacity-0 not-touch:group-hover/collection-item:pointer-events-auto not-touch:group-hover/collection-item:opacity-100 group-focus-within/collection-item:pointer-events-auto group-focus-within/collection-item:opacity-100 touch:pointer-events-auto touch:opacity-100">
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
            </div>
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
