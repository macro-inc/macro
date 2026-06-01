import Plus from '@phosphor/plus.svg';
import DeleteIcon from '@phosphor/x.svg';
import { Property as PropertyNS, useProperty } from '@property';
import { Modals } from '@property/component/modal';
import { PropertyValueIcon } from '@property/component/propertyValue/PropertyValueIcon';
import {
  PropertiesProvider,
  type PropertySaveHandler,
  usePropertiesContext,
} from '@property/context/PropertiesContext';
import { useEntityProperties, usePropertyEntityDisplay } from '@property/hooks';
import type { Property, PropertyApiValues } from '@property/types';
import { getEntityValues, hasValue } from '@property/utils';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { Button } from '@ui';
import { cn } from '@ui/utils/classname';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { SidePanel } from '../SidePanel';

export interface EntityPropertiesSectionProps {
  entityId: string;
  entityType: EntityType;
  canEdit: boolean;
  documentName?: string;
  defaultPinnedPropertyIds?: () => readonly string[];
  pinnedPropertyIds?: () => string[];
  pinnedPropertyDefinitionOrder?: readonly string[];
  onPropertyPinned?: (propertyId: string) => void;
  onPropertyUnpinned?: (propertyId: string) => void;
}

export function EntityPropertiesSection(props: EntityPropertiesSectionProps) {
  const { properties, isLoading, error, refetch } = useEntityProperties(
    props.entityId,
    props.entityType,
    false
  );

  const filteredPinnedProperties = createMemo(() => {
    const defaultPinnedIds = props.defaultPinnedPropertyIds?.() ?? [];
    const pinnedIds = props.pinnedPropertyIds?.() ?? [];
    const pinned = properties().filter(
      (property) =>
        !property.isMetadata &&
        (defaultPinnedIds.includes(property.propertyDefinitionId) ||
          pinnedIds.includes(property.propertyId))
    );

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

  const [pendingPinDefIds, setPendingPinDefIds] = createSignal<Set<string>>(
    new Set()
  );

  const handlePropertyAdded = (addedDefinitionIds?: string[]) => {
    if (
      props.onPropertyPinned &&
      addedDefinitionIds &&
      addedDefinitionIds.length > 0
    ) {
      setPendingPinDefIds((prev) => {
        const next = new Set(prev);
        for (const id of addedDefinitionIds) next.add(id);
        return next;
      });
    }
    refetch();
  };

  createEffect(() => {
    const pending = pendingPinDefIds();
    if (pending.size === 0 || !props.onPropertyPinned) return;

    const remaining = new Set(pending);
    for (const defId of pending) {
      const instance = properties().find(
        (property) => property.propertyDefinitionId === defId
      );
      if (instance) {
        props.onPropertyPinned(instance.propertyId);
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
          entityType={props.entityType}
          canEdit={props.canEdit}
          documentName={props.documentName}
          properties={filteredPinnedProperties}
          onRefresh={refetch}
          onPropertyAdded={handlePropertyAdded}
          onPropertyDeleted={refetch}
          onPropertyPinned={props.onPropertyPinned}
          onPropertyUnpinned={props.onPropertyUnpinned}
          pinnedPropertyIds={props.pinnedPropertyIds}
          saveHandler={saveHandler}
        >
          <Show when={isLoading()}>
            <SidePanel.Loading />
          </Show>

          <Show when={gridPinnedProperties().length > 0}>
            <SidePanel.Grid class="py-2">
              <For each={gridPinnedProperties()}>
                {(property) => (
                  <SidePanelPropertyRow
                    entityId={props.entityId}
                    property={property}
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
                  />
                )}
              </For>
            </div>
          </Show>

          <Show when={props.canEdit}>
            <AddPinnedPropertyButton />
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
    <button
      type="button"
      onClick={openPropertySelector}
      class={cn(
        'inline-flex items-center gap-1.5 m-px ring ring-edge-muted bg-surface',
        'px-2 py-1 leading-tight rounded-full text-ink-muted',
        'hover:bg-hover hover:text-ink transition-colors'
      )}
    >
      <Plus class="size-3" />
      <span>Add property</span>
    </button>
  );
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

function SidePanelPropertyRow(props: { entityId: string; property: Property }) {
  const ctx = usePropertiesContext();
  const t = () => props.property.valueType;
  const isMulti = () => !!props.property.isMultiSelect;

  const isMultiValueRow = () =>
    isMulti() &&
    (t() === 'SELECT_STRING' || t() === 'SELECT_NUMBER' || t() === 'ENTITY');
  const isInputType = () =>
    t() === 'STRING' || t() === 'NUMBER' || t() === 'LINK' || t() === 'BOOLEAN';

  return (
    <>
      <span
        class="text-ink-muted truncate self-center"
        title={props.property.displayName}
      >
        {props.property.displayName}
      </span>
      <div class="min-w-0 self-center">
        <PropertyNS.Root
          property={props.property}
          canEdit={ctx.canEdit}
          onSave={ctx.saveHandler.saveProperty}
          onRefresh={ctx.onRefresh}
        >
          <Switch fallback={<SinglePill property={props.property} />}>
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
      </div>
    </>
  );
}

function SinglePill(props: { property: Property }) {
  const ctx = usePropertiesContext();
  const isReadOnly = () => !ctx.canEdit || props.property.isMetadata;
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
      <PropertyNS.EditTrigger
        class={cn(SidePanel.pillClass, 'w-fit', {
          'hover:bg-hover': !isReadOnly(),
        })}
      >
        <Show when={!empty()} fallback={<SidePanel.EmptyPill />}>
          <Show
            when={isNonUserEntity() && entity()}
            fallback={
              <>
                <PropertyNS.Icon
                  property={props.property}
                  class="size-3 shrink-0"
                />
                <PropertyNS.Text property={props.property} />
              </>
            }
          >
            <span class="shrink-0 flex items-center">
              {entityDisplay.icon()}
            </span>
            <span class="truncate">{entityDisplay.name()}</span>
          </Show>
        </Show>
        <PropertyNS.Caret />
      </PropertyNS.EditTrigger>
    </PropertyNS.Tooltip>
  );
}

function UserStackPill(props: { property: Property }) {
  const ctx = usePropertiesContext();
  const isReadOnly = () => !ctx.canEdit || props.property.isMetadata;
  const empty = () => !hasValue(props.property);

  return (
    <PropertyNS.Tooltip property={props.property}>
      <PropertyNS.EditTrigger
        class={cn(SidePanel.pillClass, 'w-fit', {
          'hover:bg-hover': !isReadOnly(),
        })}
      >
        <Show when={!empty()} fallback={<SidePanel.EmptyPill />}>
          <PropertyNS.UserStack property={props.property} maxUsers={3} />
          <PropertyNS.Text property={props.property} />
        </Show>
        <PropertyNS.Caret />
      </PropertyNS.EditTrigger>
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
                <span
                  class={cn(SidePanel.pillClass, 'text-xs max-w-35 bg-hover')}
                >
                  <PropertyValueIcon
                    optionId={chip.key}
                    class="size-3 shrink-0"
                  />
                  <span class="truncate">{chip.label}</span>
                </span>
              )}
            />
            <Show when={!isReadOnly()}>
              <PropertyNS.EditTrigger
                class={cn(
                  'inline-flex items-center justify-center size-5 rounded-full',
                  'text-ink-muted hover:bg-hover hover:text-ink transition-colors'
                )}
                aria-label={`Add ${props.property.displayName}`}
              >
                <Plus class="size-3" />
              </PropertyNS.EditTrigger>
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
            <SidePanel.EmptyPill />
          </Show>
        }
      >
        <Show when={entities().length === 0 || props.property.isMultiSelect}>
          <Button
            type="button"
            variant="ghost"
            depth={0}
            size="icon-sm"
            class="size-5 rounded-full bg-surface"
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
  entityId: string;
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
      <EntityCollectionPropertyBody property={props.property} />
      <PropertyNS.PopoverEditor
        entitySelfFilter={{
          entityType: ctx.entityType,
          blockId: props.entityId,
        }}
      />
    </PropertyNS.Root>
  );
}

function EntityCollectionPropertyBody(props: { property: Property }) {
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
      <div class="p-2">
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

  const openEditor = (event: MouseEvent) => {
    if (!props.canEdit || !props.onEdit) return;
    event.stopPropagation();
    props.onEdit(containerRef);
  };

  return (
    <div
      ref={containerRef}
      class="inline-flex shrink-0 border h-7 items-stretch border-edge-muted rounded-md text-ink overflow-clip"
    >
      <button
        type="button"
        class="flex min-w-0 max-w-[20ch] items-center gap-1.5 px-2 text-left"
        onClick={openEditor}
        disabled={!props.canEdit}
      >
        <span class="shrink-0 flex items-center">{icon()}</span>
        <span class="min-w-0 truncate">{name()}</span>
      </button>
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
  );
}

function InputValue() {
  return (
    <div class="min-w-0 w-full">
      <PropertyNS.Display />
    </div>
  );
}
