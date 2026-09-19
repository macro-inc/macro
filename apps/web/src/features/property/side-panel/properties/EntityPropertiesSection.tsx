import { SidePanel } from '@components/app/side-panel/SidePanel';
import { useIsAuthenticated } from '@core/auth';
import type { BlockAlias, BlockName } from '@core/block';
import { PopupPreview } from '@core/component/DocumentPreview';
import { HoverCard } from '@core/component/HoverCard';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { itemToBlockName } from '@core/constant/allBlocks';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import Plus from '@phosphor/plus.svg';
import TrashIcon from '@phosphor/trash.svg';
import DeleteIcon from '@phosphor/x.svg';
import { Property as PropertyNS, useProperty } from '@property';
import { Modals } from '@property/component/modal';
import { PropertyValueIcon } from '@property/component/propertyValue/PropertyValueIcon';
import {
  PropertiesProvider,
  type PropertySaveHandler,
  usePropertiesContext,
} from '@property/context/PropertiesContext';
import { useAllProperties } from '@property/editor/hooks/useAllProperties';
import { useEntityProperties, usePropertyEntityDisplay } from '@property/hooks';
import { isTaggableEntityType, TagsRow } from '@property/tags';
import type {
  Property,
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '@property/types';
import { getEntityValues, hasValue } from '@property/utils';
import { isAccessiblePreviewItem, useItemPreview } from '@queries/preview';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { useTagsQuery } from '@queries/properties/tags';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { Badge, Button, Layer } from '@ui';
import { cn } from '@ui/utils/classname';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';

export interface EntityPropertiesSectionProps {
  entityId: string;
  entityType: EntityType;
  canEdit: boolean;
  documentName?: string;
  includeMetadata?: boolean;
  propertyFilter?: (property: Property) => boolean;
  getEmptyLabel?: (property: Property) => JSX.Element | undefined;
  showAddProperty?: boolean;
  showTags?: boolean;
  defaultPinnedPropertyIds?: () => readonly string[];
  pinnedPropertyIds?: () => string[];
  pinnedPropertyDefinitionOrder?: readonly string[];
  onPropertyPinned?: (propertyId: string) => void;
  onPropertyUnpinned?: (propertyId: string) => void;
  /**
   * Placeholder properties shown (and editable) even when the entity has no
   * value row for them yet — e.g. builtin CRM company defaults. Fetched
   * properties with the same definition id take precedence.
   */
  defaultProperties?: () => Property[];
  /**
   * Fetched properties with these definition ids are dropped before
   * merging with `defaultProperties` — e.g. the system Stage row when the
   * team has its own stage set.
   */
  hidePropertyDefinitionIds?: string[];
}

export interface EntityTagsSectionProps {
  entityId: string;
  entityType: EntityType;
  canEdit: boolean;
  order?: number;
}

export function EntityTagsSection(props: EntityTagsSectionProps) {
  const tagsQuery = useTagsQuery();
  const isAuthenticated = useIsAuthenticated();

  return (
    <Show when={isTaggableEntityType(props.entityType)}>
      <SidePanel.Section id="tags" title="Tags" defaultOpen order={props.order}>
        <Show
          when={isAuthenticated() !== false && !tagsQuery.isError}
          fallback={
            <span class="text-xs text-ink-extra-muted">Tags unavailable</span>
          }
        >
          <Suspense fallback={<SidePanel.Loading />}>
            <div class="text-xs">
              <TagsRow
                entityId={props.entityId}
                entityType={props.entityType}
                canEdit={props.canEdit}
                triggerVariant="pill"
              />
            </div>
          </Suspense>
        </Show>
      </SidePanel.Section>
    </Show>
  );
}

export function EntityPropertiesSection(props: EntityPropertiesSectionProps) {
  const { properties, isLoading, error, refetch, addProperty, removeProperty } =
    useEntityProperties(
      props.entityId,
      props.entityType,
      props.includeMetadata ?? false
    );
  const allProperties = useAllProperties();
  const [pendingPinDefIds, setPendingPinDefIds] = createSignal<Set<string>>(
    new Set()
  );

  const tagsQuery = useTagsQuery();
  const tagDefinitionIds = createMemo(
    () =>
      new Set(
        (tagsQuery.data ?? [])
          .map((set) => set.definition?.id)
          .filter((id): id is string => !!id)
      )
  );

  // Fetched properties merged with any default placeholders whose
  // definition the entity doesn't carry yet. Hidden definitions are
  // dropped first.
  const mergedProperties = createMemo(() => {
    const hiddenDefinitionIds = new Set(props.hidePropertyDefinitionIds ?? []);
    const fetched = properties().filter(
      (property) => !hiddenDefinitionIds.has(property.propertyDefinitionId)
    );
    const defaults = props.defaultProperties?.() ?? [];
    const fetchedDefinitionIds = new Set(
      fetched.map((property) => property.propertyDefinitionId)
    );
    const defaultDefinitionIds = new Set(
      defaults.map((property) => property.propertyDefinitionId)
    );
    const pendingPlaceholderProperties = allProperties().flatMap(
      (definition) => {
        if (!pendingPinDefIds().has(definition.id)) return [];
        if (hiddenDefinitionIds.has(definition.id)) return [];
        if (fetchedDefinitionIds.has(definition.id)) return [];
        if (defaultDefinitionIds.has(definition.id)) return [];
        const property = propertyFromPendingDefinition(definition);
        return property ? [property] : [];
      }
    );
    return [
      ...fetched,
      ...defaults.filter(
        (property) => !fetchedDefinitionIds.has(property.propertyDefinitionId)
      ),
      ...pendingPlaceholderProperties,
    ];
  });

  const filteredPinnedProperties = createMemo(() => {
    const defaultPinnedIds = props.defaultPinnedPropertyIds?.() ?? [];
    const pinnedIds = props.pinnedPropertyIds?.() ?? [];
    const usesPinnedFilter =
      props.defaultPinnedPropertyIds !== undefined ||
      props.pinnedPropertyIds !== undefined;
    const pinned = mergedProperties().filter((property) => {
      if (tagDefinitionIds().has(property.propertyDefinitionId)) {
        return false;
      }
      if (props.propertyFilter && !props.propertyFilter(property)) {
        return false;
      }
      if (property.isMetadata) return props.includeMetadata === true;
      if (pendingPinDefIds().has(property.propertyDefinitionId)) return true;
      if (!usesPinnedFilter) return true;
      return (
        defaultPinnedIds.includes(property.propertyDefinitionId) ||
        pinnedIds.includes(property.propertyId)
      );
    });

    return sortPinnedProperties(pinned, props.pinnedPropertyDefinitionOrder);
  });

  const gridPinnedProperties = createMemo(() =>
    filteredPinnedProperties().filter(
      (property) => !isNonUserMultiEntityProperty(property)
    )
  );
  const collectionPinnedProperties = createMemo(() =>
    filteredPinnedProperties().filter(isNonUserMultiEntityProperty)
  );
  const defaultPinnedDefinitionIds = createMemo(
    () => new Set(props.defaultPinnedPropertyIds?.() ?? [])
  );

  const handlePropertyAdded = (addedDefinitionIds?: string[]) => {
    if (addedDefinitionIds && addedDefinitionIds.length > 0) {
      setPendingPinDefIds((prev) => {
        const next = new Set(prev);
        for (const id of addedDefinitionIds) next.add(id);
        return next;
      });
    }
    refetch();
  };

  const removePendingProperty = (property: Property) => {
    if (!property.propertyId.startsWith('pending:')) return;
    setPendingPinDefIds((prev) => {
      const next = new Set(prev);
      next.delete(property.propertyDefinitionId);
      return next;
    });
  };

  const handlePropertyAddFailed = (definitionId: string) => {
    setPendingPinDefIds((prev) => {
      const next = new Set(prev);
      next.delete(definitionId);
      return next;
    });
    refetch();
  };

  createEffect(() => {
    const pending = pendingPinDefIds();
    if (pending.size === 0) return;

    const remaining = new Set(pending);
    for (const defId of pending) {
      const instance = properties().find(
        (property) => property.propertyDefinitionId === defId
      );
      if (instance) {
        props.onPropertyPinned?.(instance.propertyId);
        remaining.delete(defId);
      }
    }

    if (remaining.size !== pending.size) {
      setPendingPinDefIds(remaining);
    }
  });

  const saveMutation = useBulkSaveEntityPropertiesMutation();
  const saveOne = (property: Property, apiValues: PropertyApiValues) =>
    saveMutation.mutateAsync({
      properties: [
        {
          entityId: props.entityId,
          entityType: props.entityType,
          property,
          apiValues,
        },
      ],
    });

  const saveHandler: PropertySaveHandler = {
    saveProperty: (property, value) => saveOne(property, value),
    saveDate: (property, date) =>
      saveOne(property, { valueType: 'DATE', value: date }),
  };

  return (
    <Show
      when={!error()}
      fallback={
        <div class="text-failure-ink text-center py-4 text-xs">{error()}</div>
      }
    >
      <div class="text-xs">
        <PropertiesProvider
          entityId={props.entityId}
          entityType={props.entityType}
          canEdit={props.canEdit}
          documentName={props.documentName}
          properties={filteredPinnedProperties}
          onRefresh={refetch}
          onPropertyAdded={handlePropertyAdded}
          onPropertyAddFailed={handlePropertyAddFailed}
          onPropertyDeleted={refetch}
          onPropertyPinned={props.onPropertyPinned}
          onPropertyUnpinned={props.onPropertyUnpinned}
          pinnedPropertyIds={props.pinnedPropertyIds}
          addProperty={addProperty}
          removeProperty={removeProperty}
          saveHandler={saveHandler}
        >
          <Show when={isLoading()}>
            <SidePanel.Loading />
          </Show>

          <Show
            when={
              props.showTags !== false && isTaggableEntityType(props.entityType)
            }
          >
            <div class="mb-2 flex items-center gap-3">
              <span class="text-ink-muted">Tags</span>
              <TagsRow
                entityId={props.entityId}
                entityType={props.entityType}
                canEdit={props.canEdit}
              />
            </div>
          </Show>

          <Show when={gridPinnedProperties().length > 0}>
            <SidePanel.Grid class="auto-rows-[minmax(1.75rem,auto)]">
              <For each={gridPinnedProperties()}>
                {(property) => (
                  <SidePanelPropertyRow
                    entityId={props.entityId}
                    getEmptyLabel={props.getEmptyLabel}
                    property={property}
                    canRemoveFromEntity={
                      !defaultPinnedDefinitionIds().has(
                        property.propertyDefinitionId
                      )
                    }
                    onRemovePendingProperty={removePendingProperty}
                  />
                )}
              </For>
            </SidePanel.Grid>
          </Show>

          <Show when={collectionPinnedProperties().length > 0}>
            <div class="flex flex-col gap-2 pb-2">
              <For each={collectionPinnedProperties()}>
                {(property) => (
                  <EntityCollectionProperty
                    entityId={props.entityId}
                    property={property}
                    canRemoveFromEntity={
                      !defaultPinnedDefinitionIds().has(
                        property.propertyDefinitionId
                      )
                    }
                    onRemovePendingProperty={removePendingProperty}
                  />
                )}
              </For>
            </div>
          </Show>

          <Show when={props.canEdit && props.showAddProperty !== false}>
            <div class="mt-2">
              <AddPinnedPropertyButton />
            </div>
          </Show>
          <Modals />
        </PropertiesProvider>
      </div>
    </Show>
  );
}

function AddPinnedPropertyButton() {
  const { openPropertySelector } = usePropertiesContext();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      noTouchResize
      onClick={openPropertySelector}
      class="m-px rounded-full"
    >
      <Plus class="size-3" />
      <span>Add property</span>
    </Button>
  );
}

function propertyFromPendingDefinition(
  definition: PropertyDefinitionDomain
): Property | undefined {
  const base = {
    propertyId: `pending:${definition.id}`,
    propertyDefinitionId: definition.id,
    displayName: definition.displayName,
    isMultiSelect: definition.isMultiSelect,
    isMetadata: definition.isMetadata,
    isSystemProperty: definition.isSystem,
    options: definition.options,
    owner: definition.owner,
    specificEntityType: definition.specificEntityType,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  };

  return match(definition.valueType)
    .with('STRING', () => ({
      ...base,
      valueType: 'STRING' as const,
      value: null,
    }))
    .with('NUMBER', () => ({
      ...base,
      valueType: 'NUMBER' as const,
      value: null,
    }))
    .with('BOOLEAN', () => ({
      ...base,
      valueType: 'BOOLEAN' as const,
      value: null,
    }))
    .with('DATE', () => ({ ...base, valueType: 'DATE' as const, value: null }))
    .with('SELECT_STRING', () => ({
      ...base,
      valueType: 'SELECT_STRING' as const,
      value: null,
    }))
    .with('SELECT_NUMBER', () => ({
      ...base,
      valueType: 'SELECT_NUMBER' as const,
      value: null,
    }))
    .with('ENTITY', () => ({
      ...base,
      valueType: 'ENTITY' as const,
      value: null,
    }))
    .with('LINK', () => ({ ...base, valueType: 'LINK' as const, value: null }))
    .with('TAG', () => undefined)
    .exhaustive();
}

function sortPinnedProperties<T extends Property>(
  properties: T[],
  pinnedOrder: readonly string[] = []
): T[] {
  const rank = (id: string) => {
    const i = pinnedOrder.indexOf(id);
    return i === -1 ? pinnedOrder.length : i;
  };
  return [...properties].sort(
    (a, b) => rank(a.propertyDefinitionId) - rank(b.propertyDefinitionId)
  );
}

function isNonUserMultiEntityProperty(property: Property): boolean {
  return (
    property.valueType === 'ENTITY' &&
    property.isMultiSelect &&
    property.specificEntityType !== 'USER'
  );
}

function SidePanelPropertyRow(props: {
  canRemoveFromEntity: boolean;
  entityId: string;
  getEmptyLabel?: (property: Property) => JSX.Element | undefined;
  onRemovePendingProperty: (property: Property) => void;
  property: Property;
}) {
  const ctx = usePropertiesContext();
  const t = () => props.property.valueType;
  const isMulti = () => !!props.property.isMultiSelect;

  const isMultiValueRow = () =>
    isMulti() &&
    (t() === 'SELECT_STRING' || t() === 'SELECT_NUMBER' || t() === 'ENTITY');
  const isInputType = () =>
    t() === 'STRING' || t() === 'NUMBER' || t() === 'LINK' || t() === 'BOOLEAN';
  const isMultilineRow = () => t() === 'STRING' && hasValue(props.property);

  return (
    <div class="contents group/property-row">
      <span
        class={cn('text-ink-muted truncate', {
          'self-start pt-[0.3125rem]': isMultilineRow(),
          'self-center': !isMultilineRow(),
        })}
        title={props.property.displayName}
      >
        {props.property.displayName}
      </span>
      <div
        class={cn('min-w-0 max-w-full overflow-hidden', {
          'self-start py-0.5': isMultilineRow(),
          'self-center': !isMultilineRow(),
        })}
      >
        <div class="group/property-row relative min-w-0 max-w-full overflow-hidden">
          <PropertyNS.Root
            class="min-w-0 max-w-full overflow-hidden"
            property={props.property}
            canEdit={ctx.canEdit}
            onSave={ctx.saveHandler.saveProperty}
            onRefresh={ctx.onRefresh}
          >
            <Switch
              fallback={
                <SinglePill
                  getEmptyLabel={props.getEmptyLabel}
                  property={props.property}
                />
              }
            >
              <Match when={isInputType()}>
                <InputValue />
              </Match>
              <Match when={isMultiValueRow()}>
                <MultiValue property={props.property} />
              </Match>
            </Switch>
            <PropertyNS.PopoverEditor
              entitySelfFilter={{
                entityType: ctx.entityType,
                blockId: props.entityId,
              }}
            />
          </PropertyNS.Root>
          <PropertyRowActions
            canRemoveFromEntity={props.canRemoveFromEntity}
            property={props.property}
            onRemovePendingProperty={props.onRemovePendingProperty}
          />
        </div>
      </div>
    </div>
  );
}

function isPendingProperty(property: Property): boolean {
  return property.propertyId.startsWith('pending:');
}

function PropertyRowActions(props: {
  canRemoveFromEntity: boolean;
  onRemovePendingProperty: (property: Property) => void;
  property: Property;
}) {
  const ctx = usePropertiesContext();
  const [isSaving, setIsSaving] = createSignal(false);

  const canRemove = () =>
    props.canRemoveFromEntity &&
    ctx.canEdit &&
    !props.property.isMetadata &&
    (isPendingProperty(props.property) || Boolean(ctx.removeProperty));
  const hasActions = () => canRemove();

  const stopRowInteraction = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const removeFromEntity = async (event: MouseEvent) => {
    stopRowInteraction(event);
    if (!canRemove() || isSaving()) return;

    if (isPendingProperty(props.property)) {
      props.onRemovePendingProperty(props.property);
      return;
    }

    const remove = ctx.removeProperty;
    if (!remove) return;

    setIsSaving(true);
    try {
      await remove(props.property.propertyId);
      ctx.onPropertyUnpinned?.(props.property.propertyId);
      ctx.onRefresh();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Show when={hasActions()}>
      <div
        class={cn(
          'absolute right-0 top-1/2 z-1 flex -translate-y-1/2 items-center gap-0.5',
          'pointer-events-none opacity-0 transition-opacity',
          'group-hover/property-row:opacity-100 group-focus-within/property-row:opacity-100 focus-within:opacity-100'
        )}
        onMouseDown={stopRowInteraction}
      >
        <Show when={canRemove()}>
          <button
            type="button"
            title="Remove from entity"
            aria-label="Remove from entity"
            disabled={isSaving()}
            class="pointer-events-auto flex size-5 items-center justify-center rounded-full text-ink-muted outline-none ring-0 shadow-none hover:bg-hover hover:text-failure-ink focus:outline-none focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50"
            onClick={removeFromEntity}
          >
            <TrashIcon class="size-3" />
          </button>
        </Show>
      </div>
    </Show>
  );
}

function SinglePill(props: {
  getEmptyLabel?: (property: Property) => JSX.Element | undefined;
  property: Property;
}) {
  const empty = () => !hasValue(props.property);
  const isNonUserEntity = () =>
    props.property.valueType === 'ENTITY' &&
    props.property.specificEntityType !== 'USER';

  const entity = () =>
    isNonUserEntity() ? getEntityValues(props.property)[0] : undefined;

  const entityDisplay = usePropertyEntityDisplay(
    () => entity()?.entity_id ?? '',
    () => entity()?.entity_type ?? 'DOCUMENT',
    {
      specificMessageId: () => entity()?.specific_message_id,
    }
  );

  return (
    <PropertyNS.Tooltip property={props.property}>
      <PropertyNS.Pill class="w-fit overflow-hidden">
        <Show
          when={!empty()}
          fallback={
            <SidePanel.EmptyPill
              label={props.getEmptyLabel?.(props.property)}
            />
          }
        >
          <Show
            when={isNonUserEntity() && entity()}
            fallback={
              <>
                <PropertyNS.Icon
                  property={props.property}
                  class="size-3 shrink-0"
                />
                <PropertyNS.Text property={props.property} class="min-w-0" />
              </>
            }
          >
            <span class="shrink-0 flex items-center">
              {entityDisplay.icon()}
            </span>
            <span class="min-w-0 truncate">{entityDisplay.name()}</span>
          </Show>
        </Show>
        <PropertyNS.Caret />
      </PropertyNS.Pill>
    </PropertyNS.Tooltip>
  );
}

function UserStackPill(props: { property: Property }) {
  const empty = () => !hasValue(props.property);

  return (
    <PropertyNS.Tooltip property={props.property}>
      <Layer depth={2}>
        <PropertyNS.Pill class="w-fit">
          <Show when={!empty()} fallback={<SidePanel.EmptyPill />}>
            <PropertyNS.UserStack property={props.property} maxUsers={3} />
            <span class="min-w-0 truncate">
              <PropertyNS.Text property={props.property} />
            </span>
          </Show>
          <PropertyNS.Caret />
        </PropertyNS.Pill>
      </Layer>
    </PropertyNS.Tooltip>
  );
}

function MultiValue(props: { property: Property }) {
  const ctx = usePropertiesContext();
  const isReadOnly = () => !ctx.canEdit || props.property.isMetadata;
  const isEntity = () => props.property.valueType === 'ENTITY';
  const isUserEntity = () =>
    isEntity() && props.property.specificEntityType === 'USER';

  return (
    <Show
      when={!isUserEntity()}
      fallback={<UserStackPill property={props.property} />}
    >
      <PropertyNS.Tooltip property={props.property}>
        <Show
          when={!isEntity()}
          fallback={<NonUserEntityValue property={props.property} />}
        >
          <div class="flex flex-wrap items-center gap-1.5">
            <PropertyNS.Chips
              property={props.property}
              renderChip={(chip) => (
                <Layer depth={2}>
                  <Badge variant="ghost" size="sm" class="max-w-35">
                    <PropertyValueIcon
                      optionId={chip.key}
                      class="size-3 shrink-0"
                    />
                    <span class="truncate">{chip.label}</span>
                  </Badge>
                </Layer>
              )}
            />
            <Show when={!isReadOnly()}>
              <PropertyNS.Pill
                class="size-6 p-0"
                aria-label={`Add ${props.property.displayName}`}
              >
                <Plus class="size-3" />
              </PropertyNS.Pill>
            </Show>
          </div>
        </Show>
      </PropertyNS.Tooltip>
    </Show>
  );
}

function NonUserEntityValue(props: { property: Property }) {
  const ctx = usePropertiesContext();
  const propertyCtx = useProperty();
  const entities = () => getEntityValues(props.property);
  const isReadOnly = () => !ctx.canEdit || props.property.isMetadata;

  const handleRemoveEntity = async (entityId: string) => {
    const remaining = entities().filter(
      (entity) => entity.entity_id !== entityId
    );
    await ctx.saveHandler.saveProperty(props.property, {
      valueType: 'ENTITY',
      refs: remaining.length > 0 ? remaining : null,
    });
    ctx.onRefresh();
  };

  return (
    <div class="flex flex-wrap gap-1 justify-start items-start w-full min-w-0">
      <For each={entities()}>
        {(entityRef) => (
          <NonUserEntityChip
            property={props.property}
            entityId={entityRef.entity_id}
            entityType={entityRef.entity_type}
            specificMessageId={entityRef.specific_message_id}
            canEdit={!isReadOnly()}
            onRemove={() => handleRemoveEntity(entityRef.entity_id)}
            onEdit={(anchor) => {
              if (isReadOnly()) return;
              propertyCtx.openEditor(anchor);
            }}
          />
        )}
      </For>
      <Show
        when={!isReadOnly()}
        fallback={
          <Show when={entities().length === 0}>
            <Badge variant="ghost" size="sm">
              <SidePanel.EmptyPill />
            </Badge>
          </Show>
        }
      >
        <Show when={entities().length === 0 || props.property.isMultiSelect}>
          <Button
            type="button"
            variant="ghost"
            depth={0}
            size="icon-sm"
            class="rounded-full"
            aria-label={`Add ${props.property.displayName}`}
            onClick={(event) => {
              event.stopPropagation();
              propertyCtx.openEditor(event.currentTarget);
            }}
          >
            <Plus class="size-3" />
          </Button>
        </Show>
      </Show>
    </div>
  );
}

function EntityCollectionProperty(props: {
  canRemoveFromEntity: boolean;
  entityId: string;
  onRemovePendingProperty: (property: Property) => void;
  property: Property;
}) {
  const ctx = usePropertiesContext();

  return (
    <PropertyNS.Root
      property={props.property}
      canEdit={ctx.canEdit}
      onSave={ctx.saveHandler.saveProperty}
      onRefresh={ctx.onRefresh}
    >
      <EntityCollectionPropertyBody
        canRemoveFromEntity={props.canRemoveFromEntity}
        property={props.property}
        onRemovePendingProperty={props.onRemovePendingProperty}
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
  canRemoveFromEntity: boolean;
  onRemovePendingProperty: (property: Property) => void;
  property: Property;
}) {
  const ctx = usePropertiesContext();
  const propertyCtx = useProperty();
  const entities = () => getEntityValues(props.property);
  const isReadOnly = () => !ctx.canEdit || props.property.isMetadata;

  const handleRemoveEntity = async (entityId: string) => {
    const remaining = entities().filter(
      (entity) => entity.entity_id !== entityId
    );
    await ctx.saveHandler.saveProperty(props.property, {
      valueType: 'ENTITY',
      refs: remaining.length > 0 ? remaining : null,
    });
    ctx.onRefresh();
  };

  return (
    <SidePanel.Card>
      <div class="group/property-row relative p-2">
        <div class="flex items-center justify-between gap-2">
          <span
            class="min-w-0 truncate text-ink-muted"
            title={props.property.displayName}
          >
            {props.property.displayName}
          </span>
          <Show when={!isReadOnly()}>
            <Button
              type="button"
              variant="ghost"
              depth={0}
              size="icon-sm"
              class="size-5 rounded-full"
              aria-label={`Add ${props.property.displayName}`}
              onClick={(event) => {
                event.stopPropagation();
                propertyCtx.openEditor(event.currentTarget);
              }}
            >
              <Plus class="size-3" />
            </Button>
          </Show>
          <PropertyRowActions
            canRemoveFromEntity={props.canRemoveFromEntity}
            property={props.property}
            onRemovePendingProperty={props.onRemovePendingProperty}
          />
        </div>
        <div class="mt-2 flex flex-wrap gap-1.5">
          <For
            each={entities()}
            fallback={<span class="text-ink-extra-muted">Empty</span>}
          >
            {(entityRef) => (
              <NonUserEntityChip
                property={props.property}
                entityId={entityRef.entity_id}
                entityType={entityRef.entity_type}
                specificMessageId={entityRef.specific_message_id}
                canEdit={!isReadOnly()}
                onRemove={() => handleRemoveEntity(entityRef.entity_id)}
                onEdit={(anchor) => {
                  if (isReadOnly()) return;
                  propertyCtx.openEditor(anchor);
                }}
              />
            )}
          </For>
        </div>
      </div>
    </SidePanel.Card>
  );
}

function NonUserEntityChip(props: {
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
            type="button"
            size="icon-sm"
            class="flex w-6 p-1 h-full shrink-0 rounded-none text-ink-muted not-disabled:hover:text-failure-ink"
            onClick={(event) => {
              event.stopPropagation();
              props.onRemove?.();
            }}
            aria-label={`Remove ${name()}`}
          >
            <DeleteIcon />
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

function InputValue() {
  return (
    <div class="min-w-0 max-w-full overflow-hidden">
      <PropertyNS.Display />
    </div>
  );
}
