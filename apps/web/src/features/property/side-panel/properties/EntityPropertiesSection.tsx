import { t } from '@app/lib/i18n';
import {
  SidePanel,
  type SidePanelSectionLayout,
} from '@components/app/side-panel/SidePanel';
import { fireAndForget } from '@core/util/fireAndForget';
import Plus from '@icon/system/regular/plus.svg';
import { Property as PropertyNS, useProperty } from '@property';
import { AddPropertyButton } from '@property/component/AddPropertyButton';
import { Modals } from '@property/component/modal';
import { PropertyValueIcon } from '@property/component/propertyValue/PropertyValueIcon';
import {
  PropertiesProvider,
  type PropertySaveHandler,
  usePropertiesContext,
} from '@property/context/PropertiesContext';
import { resolvePinnedPropertyIds } from '@property/core/pinned-property-ids';
import { useAllProperties } from '@property/editor/hooks/useAllProperties';
import { useEntityProperties, usePropertyEntityDisplay } from '@property/hooks';
import { isTaggableEntityType, TagsRow } from '@property/tags';
import type {
  Property,
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '@property/types';
import { getEntityValues, hasValue } from '@property/utils';
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
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import {
  EntityCollectionProperty,
  NonUserEntityChip,
} from './EntityCollectionProperty';
import { isPendingProperty, PropertyRowActions } from './PropertyRowActions';

export interface EntityPropertiesSectionProps {
  entityId: string;
  entityType: EntityType;
  canEdit: boolean;
  onPropertiesChanged?: () => void | Promise<void>;
  documentName?: string;
  includeMetadata?: boolean;
  propertyFilter?: (property: Property) => boolean;
  getEmptyLabel?: (property: Property) => JSX.Element | undefined;
  showAddProperty?: boolean;
  renderSection?: SidePanelSectionLayout;
  showTags?: boolean;
  defaultPinnedPropertyIds?: () => readonly string[];
  /** Keep required fields attached without hiding other entity properties. */
  requiredPropertyDefinitionIds?: readonly string[];
  pinnedPropertyIds?: () => string[] | undefined;
  /** Implicit title pins for hosts whose saved pin list is still absent. */
  defaultTitlePropertyDefinitionIds?: () => readonly string[];
  pinnedPropertyDefinitionOrder?: readonly string[];
  /** Explicit title-row pin action; adding a property does not pin it. */
  onPropertyPinned?: (propertyId: string, properties: Property[]) => void;
  onPropertyUnpinned?: (
    propertyId: string,
    properties: Property[],
    propertyDefinitionId?: string
  ) => void;
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

export {
  EntityTagsSection,
  type EntityTagsSectionProps,
} from './EntityTagsSection';

export function EntityPropertiesSection(props: EntityPropertiesSectionProps) {
  const { properties, isLoading, error, refetch, addProperty, removeProperty } =
    useEntityProperties(
      props.entityId,
      props.entityType,
      props.includeMetadata ?? false
    );
  const allProperties = useAllProperties();
  const [pendingDefinitionIds, setPendingDefinitionIds] = createSignal<
    Set<string>
  >(new Set());

  const tagsQuery = useTagsQuery();
  const tagDefinitionIds = createMemo(
    () =>
      new Set(
        (tagsQuery.isSuccess ? tagsQuery.data : [])
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
        if (!pendingDefinitionIds().has(definition.id)) return [];
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

  const filteredProperties = createMemo(() => {
    // Pins control the title row only. The panel lists every assigned property.
    const visible = mergedProperties().filter((property) => {
      if (tagDefinitionIds().has(property.propertyDefinitionId)) {
        return false;
      }
      if (props.propertyFilter && !props.propertyFilter(property)) {
        return false;
      }
      if (property.isMetadata) return props.includeMetadata === true;
      return true;
    });

    return sortPinnedProperties(visible, props.pinnedPropertyDefinitionOrder);
  });

  const gridProperties = createMemo(() =>
    filteredProperties().filter(
      (property) => !isNonUserMultiEntityProperty(property)
    )
  );
  const collectionProperties = createMemo(() =>
    filteredProperties().filter(isNonUserMultiEntityProperty)
  );
  const defaultPinnedDefinitionIds = createMemo(
    () =>
      new Set([
        ...(props.defaultPinnedPropertyIds?.() ?? []),
        ...(props.requiredPropertyDefinitionIds ?? []),
      ])
  );

  const titlePinnedIds = () =>
    resolvePinnedPropertyIds(
      mergedProperties(),
      props.pinnedPropertyIds?.(),
      props.defaultTitlePropertyDefinitionIds?.()
    );
  const pinProperty = (id: string) =>
    props.onPropertyPinned?.(id, mergedProperties());
  const unpinProperty = (id: string, definitionId?: string) =>
    props.onPropertyUnpinned?.(id, mergedProperties(), definitionId);

  const addEntityProperty = async (definitionId: string) => {
    // The entity can carry a definition it never pinned (set at creation or
    // through the API); attaching it again would clear the value.
    if (
      properties().some(
        (property) => property.propertyDefinitionId === definitionId
      )
    )
      return;
    await addProperty(definitionId);
    await props.onPropertiesChanged?.();
  };
  const removeEntityProperty = async (propertyId: string) => {
    await removeProperty(propertyId);
    await props.onPropertiesChanged?.();
  };

  const handlePropertyAdded = (addedDefinitionIds?: string[]) => {
    if (addedDefinitionIds && addedDefinitionIds.length > 0) {
      setPendingDefinitionIds((prev) => {
        const next = new Set(prev);
        for (const id of addedDefinitionIds) next.add(id);
        return next;
      });
    }
    fireAndForget(refetch(), 'property-added-refresh');
  };

  const removePendingProperty = (property: Property) => {
    if (!property.propertyId.startsWith('pending:')) return;
    setPendingDefinitionIds((prev) => {
      const next = new Set(prev);
      next.delete(property.propertyDefinitionId);
      return next;
    });
  };

  const handlePropertyAddFailed = (definitionId: string) => {
    setPendingDefinitionIds((prev) => {
      const next = new Set(prev);
      next.delete(definitionId);
      return next;
    });
    fireAndForget(refetch(), 'property-add-failed-refresh');
  };

  createEffect(() => {
    const pending = pendingDefinitionIds();
    if (pending.size === 0) return;

    const remaining = new Set(pending);
    for (const defId of pending) {
      const instance = properties().find(
        (property) => property.propertyDefinitionId === defId
      );
      if (instance) {
        remaining.delete(defId);
      }
    }

    if (remaining.size !== pending.size) {
      setPendingDefinitionIds(remaining);
    }
  });

  const saveMutation = useBulkSaveEntityPropertiesMutation();
  const savePropertyValues = async (
    property: Property,
    apiValues: PropertyApiValues
  ) => {
    await saveMutation.mutateAsync({
      properties: [
        {
          entityId: props.entityId,
          entityType: props.entityType,
          property,
          apiValues,
        },
      ],
    });
  };
  const saveOne = async (property: Property, apiValues: PropertyApiValues) => {
    await savePropertyValues(property, apiValues);
    await props.onPropertiesChanged?.();
  };
  const refreshCollection = async () => {
    await refetch();
    await props.onPropertiesChanged?.();
  };

  const saveHandler: PropertySaveHandler = {
    saveProperty: (property, value) => saveOne(property, value),
    saveDate: (property, date) =>
      saveOne(property, { valueType: 'DATE', value: date }),
  };

  const canShowProperties = () => !error() || properties().length > 0;
  const renderContent = () => (
    <Show
      when={canShowProperties()}
      fallback={
        <div class="text-failure-ink text-center py-4 text-xs">{error()}</div>
      }
    >
      <div class="flex flex-col gap-1 text-xs">
        <Show when={isLoading()}>
          <SidePanel.Loading />
        </Show>

        <Show
          when={
            props.showTags !== false && isTaggableEntityType(props.entityType)
          }
        >
          <div class="flex items-center gap-3">
            <span class="w-(--sidepanel-label-width) shrink-0 text-ink-muted">
              Tags
            </span>
            <TagsRow
              entityId={props.entityId}
              entityType={props.entityType}
              canEdit={props.canEdit}
            />
          </div>
        </Show>

        <Show when={gridProperties().length > 0}>
          <SidePanel.Grid
            class={cn(
              'auto-rows-[minmax(1.75rem,auto)] gap-y-1',
              collectionProperties().length === 0 &&
                props.canEdit &&
                props.showAddProperty !== false &&
                'mb-3'
            )}
          >
            <For each={gridProperties()}>
              {(property) => (
                <SidePanelPropertyRow
                  entityId={props.entityId}
                  getEmptyLabel={props.getEmptyLabel}
                  property={property}
                  canRemoveFromEntity={
                    !defaultPinnedDefinitionIds().has(
                      property.propertyDefinitionId
                    ) &&
                    !(
                      isPendingProperty(property) &&
                      props
                        .defaultProperties?.()
                        .some(
                          (placeholder) =>
                            placeholder.propertyDefinitionId ===
                            property.propertyDefinitionId
                        )
                    )
                  }
                  canPinPendingProperty={props
                    .defaultTitlePropertyDefinitionIds?.()
                    .includes(property.propertyDefinitionId)}
                  onRemovePendingProperty={removePendingProperty}
                  onPropertyPinned={
                    props.onPropertyPinned ? pinProperty : undefined
                  }
                />
              )}
            </For>
          </SidePanel.Grid>
        </Show>

        <Show when={collectionProperties().length > 0}>
          <div
            class={cn(
              'flex flex-col gap-1',
              props.canEdit && props.showAddProperty !== false && 'mb-3'
            )}
          >
            <For
              each={collectionProperties().map(
                (property) => property.propertyDefinitionId
              )}
            >
              {(definitionId) => {
                const saving = createSignal(false);
                return (
                  <Show
                    when={collectionProperties().find(
                      (property) =>
                        property.propertyDefinitionId === definitionId
                    )}
                  >
                    {(property) => (
                      <EntityCollectionProperty
                        entityId={props.entityId}
                        loading={isLoading()}
                        onSave={savePropertyValues}
                        onRefresh={refreshCollection}
                        property={property()}
                        saving={saving}
                      >
                        <PropertyRowActions.Root
                          saving={saving}
                          onRefresh={refetch}
                          canRemoveFromEntity={
                            !defaultPinnedDefinitionIds().has(
                              property().propertyDefinitionId
                            )
                          }
                          property={property()}
                          onRemovePendingProperty={removePendingProperty}
                          onPropertyPinned={
                            props.onPropertyPinned ? pinProperty : undefined
                          }
                        >
                          <PropertyRowActions.Pin />
                          <PropertyRowActions.Remove />
                        </PropertyRowActions.Root>
                      </EntityCollectionProperty>
                    )}
                  </Show>
                );
              }}
            </For>
          </div>
        </Show>

        <Show when={props.canEdit && props.showAddProperty !== false}>
          <div class="flex items-center">
            <AddPropertyButton size="xs" class="m-px gap-1.5" />
          </div>
        </Show>
      </div>
    </Show>
  );

  return (
    <PropertiesProvider
      entityId={props.entityId}
      entityType={props.entityType}
      canEdit={props.canEdit}
      documentName={props.documentName}
      properties={filteredProperties}
      onRefresh={refetch}
      onPropertyAdded={handlePropertyAdded}
      onPropertyAddFailed={handlePropertyAddFailed}
      onPropertyDeleted={refetch}
      onPropertyUnpinned={props.onPropertyUnpinned ? unpinProperty : undefined}
      pinnedPropertyIds={titlePinnedIds}
      addProperty={addEntityProperty}
      removeProperty={removeEntityProperty}
      saveHandler={saveHandler}
    >
      {props.renderSection
        ? props.renderSection(
            renderContent,
            <Show
              when={
                canShowProperties() &&
                props.canEdit &&
                props.showAddProperty !== false
              }
            >
              <AddPropertyHeaderAction />
            </Show>
          )
        : renderContent()}
      <Modals />
    </PropertiesProvider>
  );
}

function AddPropertyHeaderAction() {
  const ctx = usePropertiesContext();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      class="text-ink-extra-muted"
      aria-label={t('common.addProperty')}
      title={t('common.addProperty')}
      onClick={(event) => {
        event.stopPropagation();
        ctx.openPropertySelector();
      }}
    >
      <Plus class="size-4" />
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
    .with('DATE_RANGE', () => ({
      ...base,
      valueType: 'DATE_RANGE' as const,
      value: null,
    }))
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
    .exhaustive(() => undefined);
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
  canPinPendingProperty?: boolean;
  entityId: string;
  getEmptyLabel?: (property: Property) => JSX.Element | undefined;
  onRemovePendingProperty: (property: Property) => void;
  onPropertyPinned?: (propertyId: string) => void;
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
  const hasInlineAddAction = () =>
    isMultiValueRow() &&
    !(t() === 'ENTITY' && props.property.specificEntityType === 'USER');

  return (
    <div class="contents group/property-row">
      <span
        class={cn('min-w-0 truncate text-ink-muted', {
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
        <div class="group/property-row flex min-w-0 max-w-full items-center gap-1 overflow-hidden">
          <PropertyNS.Root
            class="min-w-0 max-w-full flex-1 overflow-hidden"
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
                <MultiValue property={props.property}>
                  <PropertyRowActions.Root
                    canRemoveFromEntity={props.canRemoveFromEntity}
                    canPinPendingProperty={props.canPinPendingProperty}
                    property={props.property}
                    onRemovePendingProperty={props.onRemovePendingProperty}
                    onPropertyPinned={props.onPropertyPinned}
                  >
                    <PropertyRowActions.Pin />
                    <PropertyRowActions.Remove />
                  </PropertyRowActions.Root>
                </MultiValue>
              </Match>
            </Switch>
            <PropertyNS.PopoverEditor
              entitySelfFilter={{
                entityType: ctx.entityType,
                blockId: props.entityId,
              }}
            />
          </PropertyNS.Root>
          <Show when={!hasInlineAddAction()}>
            <PropertyRowActions.Root
              canRemoveFromEntity={props.canRemoveFromEntity}
              canPinPendingProperty={props.canPinPendingProperty}
              property={props.property}
              onRemovePendingProperty={props.onRemovePendingProperty}
              onPropertyPinned={props.onPropertyPinned}
            >
              <PropertyRowActions.Remove />
              <PropertyRowActions.Pin />
            </PropertyRowActions.Root>
          </Show>
        </div>
      </div>
    </div>
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

function MultiValue(props: { property: Property; children: JSX.Element }) {
  const ctx = usePropertiesContext();
  const propertyCtx = useProperty();
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
          fallback={
            <NonUserEntityValue property={props.property}>
              {props.children}
            </NonUserEntityValue>
          }
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
            <div class="flex shrink-0 items-center">
              <Show when={!isReadOnly()}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  class="text-ink-extra-muted"
                  aria-label={`Add ${props.property.displayName}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    propertyCtx.openEditor(event.currentTarget);
                  }}
                >
                  <Plus class="size-4" />
                </Button>
              </Show>
              {props.children}
            </div>
          </div>
        </Show>
      </PropertyNS.Tooltip>
    </Show>
  );
}

function NonUserEntityValue(props: {
  property: Property;
  children: JSX.Element;
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
      <div class="flex shrink-0 items-center">
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
              size="icon-xs"
              class="text-ink-extra-muted"
              aria-label={`Add ${props.property.displayName}`}
              onClick={(event) => {
                event.stopPropagation();
                propertyCtx.openEditor(event.currentTarget);
              }}
            >
              <Plus class="size-4" />
            </Button>
          </Show>
        </Show>
        {props.children}
      </div>
    </div>
  );
}

function InputValue() {
  return (
    <div class="min-w-0 max-w-full overflow-hidden">
      <PropertyNS.Display />
    </div>
  );
}
