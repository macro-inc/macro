import { t } from '@app/lib/i18n';
import {
  SidePanel,
  type SidePanelSectionLayout,
} from '@components/app/side-panel/SidePanel';
import { fireAndForget } from '@core/util/fireAndForget';
import Plus from '@icon/system/regular/plus.svg';
import { Telemetry } from '@macro-inc/observability';
import { Property as PropertyNS, useProperty } from '@property';
import { AddPropertyButton } from '@property/component/AddPropertyButton';
import { EntityLinkPill } from '@property/component/EntityLinkPill';
import { Modals } from '@property/component/modal';
import { ProjectLinkPill } from '@property/component/ProjectLinkPill';
import { PropertyValueIcon } from '@property/component/propertyValue/PropertyValueIcon';
import { SourceLinkPill } from '@property/component/SourceLinkPill';
import {
  PropertiesProvider,
  type PropertySaveHandler,
  usePropertiesContext,
} from '@property/context/PropertiesContext';
import { resolvePinnedPropertyIds } from '@property/core/pinned-property-ids';
import { useAllProperties } from '@property/editor/hooks/useAllProperties';
import { StartDueEditor } from '@property/editors/popover/StartDueEditor';
import { useEntityProperties, usePropertyEntityDisplay } from '@property/hooks';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { isTaggableEntityType, TagsRow } from '@property/tags';
import type {
  DateApiValue,
  DateProperty,
  Property,
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '@property/types';
import { getEntityValues, hasValue, isDateProperty } from '@property/utils';
import { type DateField, dateFieldOf } from '@property/utils/start-due';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { useTagsQuery } from '@queries/properties/tags';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { Key } from '@solid-primitives/keyed';
import { Badge, Button, Layer } from '@ui';
import { cn } from '@ui/utils/classname';
import { ResultAsync } from 'neverthrow';
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
  type CollectionSaveOutcome,
  EntityCollectionProperty,
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
  /** Start Date and Due Date rows open one picker for both, each on its own end. */
  pairStartAndDue?: () => boolean;
}

export {
  EntityTagsSection,
  type EntityTagsSectionProps,
} from './EntityTagsSection';

export function EntityPropertiesSection(props: EntityPropertiesSectionProps) {
  const {
    properties,
    isLoading,
    error,
    refetch,
    isCacheMaintained,
    addProperty,
    removeProperty,
  } = useEntityProperties(
    props.entityId,
    props.entityType,
    props.includeMetadata ?? false
  );
  // The definitions this entity can take: the same list Add property asks for,
  // so it is already loaded when the picker opens.
  const allProperties = useAllProperties(
    () => true,
    () => props.entityType
  );
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
      // Time logged is the sum of a task's entries: the Time pill shows and
      // changes it, never a generic number row.
      if (property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.TIME_LOGGED) {
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
    apiValues: PropertyApiValues,
    onAccepted?: () => void
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
      onAccepted,
    });
  };
  const saveOne = async (property: Property, apiValues: PropertyApiValues) => {
    await savePropertyValues(property, apiValues);
    // The value is saved; a refresh failing afterwards is not a failed save.
    const refreshed = await ResultAsync.fromPromise(
      Promise.resolve(props.onPropertiesChanged?.()),
      (error) => error
    );
    if (refreshed.isErr()) {
      Telemetry.error(refreshed.error, { surface: 'property-side-panel' });
    }
  };
  const refreshCollection = async (outcome: CollectionSaveOutcome) => {
    // The cache already holds a committed save; a network read could bring a
    // lagging replica's older value back. A failed save or an uncached client
    // has only the server to read from.
    if (outcome === 'failed' || !isCacheMaintained()) await refetch();
    if (outcome === 'saved') await props.onPropertiesChanged?.();
  };

  const saveHandler: PropertySaveHandler = {
    saveProperty: (property, value) => saveOne(property, value),
    saveDate: (property, date) =>
      saveOne(property, { valueType: 'DATE', value: date }),
  };

  const dateEnd = (field: DateField): DateProperty | undefined => {
    const definitionId =
      field === 'start'
        ? SYSTEM_PROPERTY_IDS.START_DATE
        : SYSTEM_PROPERTY_IDS.DUE_DATE;
    const property = mergedProperties().find(
      (candidate) => candidate.propertyDefinitionId === definitionId
    );
    return property && isDateProperty(property) ? property : undefined;
  };
  const otherDateEnd = (property: Property) => {
    if (!props.pairStartAndDue?.()) return undefined;
    const field = dateFieldOf(property.propertyDefinitionId);
    if (!field) return undefined;
    return dateEnd(field === 'start' ? 'due' : 'start');
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
            <Key each={gridProperties()} by="propertyDefinitionId">
              {(property) => (
                <SidePanelPropertyRow
                  entityId={props.entityId}
                  getEmptyLabel={props.getEmptyLabel}
                  property={property()}
                  otherDateEnd={() => otherDateEnd(property())}
                  saveOtherDateEnd={(end, value) => saveOne(end, value)}
                  canRemoveFromEntity={
                    !defaultPinnedDefinitionIds().has(
                      property().propertyDefinitionId
                    ) &&
                    !(
                      isPendingProperty(property()) &&
                      props
                        .defaultProperties?.()
                        .some(
                          (placeholder) =>
                            placeholder.propertyDefinitionId ===
                            property().propertyDefinitionId
                        )
                    )
                  }
                  canPinPendingProperty={props
                    .defaultTitlePropertyDefinitionIds?.()
                    .includes(property().propertyDefinitionId)}
                  onRemovePendingProperty={removePendingProperty}
                  onPropertyPinned={
                    props.onPropertyPinned ? pinProperty : undefined
                  }
                />
              )}
            </Key>
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
                      <PropertyRowActions.Provider
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
                        <EntityCollectionProperty
                          entityId={props.entityId}
                          loading={isLoading()}
                          onSave={savePropertyValues}
                          onRefresh={refreshCollection}
                          property={property()}
                          saving={saving}
                          actionsBeforeAdd={<PropertyRowActions.Remove />}
                          actionsAfterAdd={<PropertyRowActions.Pin />}
                        />
                      </PropertyRowActions.Provider>
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
  /** The other end of a Start Date or Due Date row that opens both. */
  otherDateEnd?: () => DateProperty | undefined;
  saveOtherDateEnd?: (
    property: DateProperty,
    value: DateApiValue
  ) => Promise<unknown>;
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
          >
            {(property) => (
              <>
                <Switch
                  fallback={
                    <SinglePill
                      getEmptyLabel={props.getEmptyLabel}
                      property={property()}
                    />
                  }
                >
                  <Match when={isInputType()}>
                    <InputValue
                      property={property()}
                      getEmptyLabel={props.getEmptyLabel}
                    />
                  </Match>
                  <Match when={isMultiValueRow()}>
                    <PropertyRowActions.Provider
                      canRemoveFromEntity={props.canRemoveFromEntity}
                      canPinPendingProperty={props.canPinPendingProperty}
                      property={props.property}
                      onRemovePendingProperty={props.onRemovePendingProperty}
                      onPropertyPinned={props.onPropertyPinned}
                    >
                      <MultiValue
                        property={property()}
                        getEmptyLabel={props.getEmptyLabel}
                        actionsBeforeAdd={<PropertyRowActions.Remove />}
                        actionsAfterAdd={<PropertyRowActions.Pin />}
                      />
                    </PropertyRowActions.Provider>
                  </Match>
                </Switch>
                <Show
                  when={props.otherDateEnd?.()}
                  fallback={
                    <PropertyNS.PopoverEditor
                      entitySelfFilter={{
                        entityType: ctx.entityType,
                        blockId: props.entityId,
                      }}
                    />
                  }
                >
                  {(other) => (
                    <StartDueEditor
                      field={
                        dateFieldOf(props.property.propertyDefinitionId) ??
                        'due'
                      }
                      other={() => props.otherDateEnd?.() ?? other()}
                      saveOther={(end, value) =>
                        props.saveOtherDateEnd?.(end, value) ??
                        Promise.resolve()
                      }
                    />
                  )}
                </Show>
              </>
            )}
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

function EmptyPropertyValue(props: {
  property: Property;
  getEmptyLabel?: (property: Property) => JSX.Element | undefined;
}) {
  const label = () =>
    props.getEmptyLabel?.(props.property) ??
    match(props.property.propertyDefinitionId)
      .with(SYSTEM_PROPERTY_IDS.ASSIGNEES, () => 'Unassigned')
      .with(SYSTEM_PROPERTY_IDS.STATUS, () => 'No status')
      .with(SYSTEM_PROPERTY_IDS.PRIORITY, () => 'No priority')
      .with(SYSTEM_PROPERTY_IDS.DUE_DATE, () => 'No due date')
      .with(SYSTEM_PROPERTY_IDS.PROJECT, () => 'No project')
      .otherwise(() => 'Not set');

  return (
    <PropertyNS.Empty
      propertyDefinitionId={props.property.propertyDefinitionId}
      label={label()}
      iconClass={
        props.property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PROJECT
          ? 'touch:size-4'
          : undefined
      }
    />
  );
}

/**
 * One value in a pill that opens the picker. A single referenced item other
 * than a person splits it instead: its name opens the item and a caret opens
 * the picker, so a viewer who cannot edit still gets the link.
 */
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

  const pill = () => (
    <PropertyNS.Pill class="w-fit overflow-hidden">
      <Show
        when={!empty()}
        fallback={
          <EmptyPropertyValue
            property={props.property}
            getEmptyLabel={props.getEmptyLabel}
          />
        }
      >
        <Show
          when={isNonUserEntity() && entity()}
          fallback={
            <>
              <PropertyNS.Icon
                property={props.property}
                class={
                  props.property.propertyDefinitionId ===
                    SYSTEM_PROPERTY_IDS.STATUS ||
                  props.property.propertyDefinitionId ===
                    SYSTEM_PROPERTY_IDS.PRIORITY
                    ? 'size-4 shrink-0'
                    : 'size-3 shrink-0'
                }
              />
              <PropertyNS.Text property={props.property} class="min-w-0" />
            </>
          }
        >
          <span class="shrink-0 flex items-center">{entityDisplay.icon()}</span>
          <span class="min-w-0 truncate">{entityDisplay.name()}</span>
        </Show>
      </Show>
      <PropertyNS.Caret />
    </PropertyNS.Pill>
  );

  return (
    <PropertyNS.Tooltip property={props.property}>
      <Switch fallback={pill()}>
        <Match
          when={
            props.property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.SOURCE
          }
        >
          <SourceLinkPill
            property={props.property}
            showSourceIcon={false}
            variant="ghost"
            iconClass="touch:size-4"
            fallback={pill()}
          />
        </Match>
        <Match when={entity()?.entity_type === 'INITIATIVE'}>
          <ProjectLinkPill
            property={props.property}
            variant="ghost"
            iconClass="touch:size-4"
            fallback={pill()}
          />
        </Match>
        <Match when={entity()}>
          <EntityLinkPill
            property={props.property}
            variant="ghost"
            iconClass="touch:size-4"
            fallback={pill()}
            openLabel={(name) => t('entityActions.openEntityNamed', { name })}
            changeLabel={t('entityActions.changeEntity', {
              property: props.property.displayName,
            })}
          />
        </Match>
      </Switch>
    </PropertyNS.Tooltip>
  );
}

function UserStackPill(props: {
  property: Property;
  getEmptyLabel?: (property: Property) => JSX.Element | undefined;
}) {
  const empty = () => !hasValue(props.property);

  return (
    <PropertyNS.Tooltip property={props.property}>
      <Layer depth={2}>
        <PropertyNS.Pill class="w-fit">
          <Show
            when={!empty()}
            fallback={
              <EmptyPropertyValue
                property={props.property}
                getEmptyLabel={props.getEmptyLabel}
              />
            }
          >
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

function MultiValue(props: {
  property: Property;
  getEmptyLabel?: (property: Property) => JSX.Element | undefined;
  /** Row actions shown before the add button; the trash goes here. */
  actionsBeforeAdd: JSX.Element;
  /** Row actions shown after the add button; the pin goes here. */
  actionsAfterAdd: JSX.Element;
}) {
  const ctx = usePropertiesContext();
  const propertyCtx = useProperty();
  const isReadOnly = () => !ctx.canEdit || props.property.isMetadata;
  // Multi-value entity properties other than people render as collections
  // (`EntityCollectionProperty`) and never reach this row.
  const isUserEntity = () =>
    props.property.valueType === 'ENTITY' &&
    props.property.specificEntityType === 'USER';

  return (
    <Show
      when={!isUserEntity()}
      fallback={
        <UserStackPill
          property={props.property}
          getEmptyLabel={props.getEmptyLabel}
        />
      }
    >
      <PropertyNS.Tooltip property={props.property}>
        <div class="flex flex-wrap items-center gap-1.5">
          <Show when={!hasValue(props.property)}>
            <PropertyNS.Pill class="w-fit overflow-hidden">
              <EmptyPropertyValue
                property={props.property}
                getEmptyLabel={props.getEmptyLabel}
              />
              <PropertyNS.Caret />
            </PropertyNS.Pill>
          </Show>
          <PropertyNS.Chips
            property={props.property}
            renderChip={(chip) => (
              <Layer depth={2}>
                <Badge variant="ghost" size="sm" class="max-w-35">
                  <PropertyValueIcon
                    optionId={chip.key}
                    class={
                      props.property.propertyDefinitionId ===
                        SYSTEM_PROPERTY_IDS.STATUS ||
                      props.property.propertyDefinitionId ===
                        SYSTEM_PROPERTY_IDS.PRIORITY
                        ? 'size-4 shrink-0'
                        : 'size-3 shrink-0'
                    }
                  />
                  <span class="truncate">{chip.label}</span>
                </Badge>
              </Layer>
            )}
          />
          <div class="flex shrink-0 items-center gap-0.5">
            {props.actionsBeforeAdd}
            <Show when={!isReadOnly() && hasValue(props.property)}>
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
            {props.actionsAfterAdd}
          </div>
        </div>
      </PropertyNS.Tooltip>
    </Show>
  );
}

function InputValue(props: {
  property: Property;
  getEmptyLabel?: (property: Property) => JSX.Element | undefined;
}) {
  return (
    <div class="min-w-0 max-w-full overflow-hidden">
      <PropertyNS.InlineEditor
        emptyValue={
          <EmptyPropertyValue
            property={props.property}
            getEmptyLabel={props.getEmptyLabel}
          />
        }
      />
    </div>
  );
}
