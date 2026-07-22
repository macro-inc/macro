import { toast } from '@core/component/Toast/Toast';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import type { IUser } from '@core/user';
import { idToDisplayName, idToEmail } from '@core/user/util';
import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import { useDateSearch } from '@core/util/dateSearch/useDateSearch';
import { fuzzyFilter } from '@core/util/fuzzy';
import {
  type ListNavActions,
  useListKeyBindings,
} from '@core/util/useListKeyBindings';
import { type EntityData, InlineEntity } from '@entity';
import CircleDashedEmpty from '@phosphor/circle-dashed.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import PropertiesIcon from '@phosphor/sliders-horizontal.svg';
import TagIcon from '@phosphor/tag-simple.svg';
import { type CombinedEntity, getEntityName, getEntityType } from '@property';
import { PropertyValueIcon } from '@property/component/propertyValue';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { OptionCheckBox } from '@property/editors/selectors/OptionCheckBox';
import { usePropertySelection } from '@property/hooks';
import { usePropertyEntityDisplay } from '@property/hooks/usePropertyEntityDisplay';
import { TagDot } from '@property/tags/TagDot';
import {
  TagEditorDialog,
  type TagEditorDialogMode,
} from '@property/tags/TagEditorDialog';
import type {
  Property,
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '@property/types';
import {
  macroEntityToPropertyEntityType,
  PropertyDataTypeIcon,
  toPropertyApiValue,
} from '@property/utils';
import {
  useAddEntityPropertyOptionMutation,
  useEntityPropertiesQuery,
  useRemoveEntityPropertyOptionMutation,
} from '@queries/properties/entity';
import { useTagsQuery } from '@queries/properties/tags';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { PropertyDefinitionDetailResponse } from '@service-properties/generated/schemas/propertyDefinitionDetailResponse';
import type { PropertyOptionResponse } from '@service-properties/generated/schemas/propertyOptionResponse';
import type { TagScope } from '@service-properties/generated/schemas/tagScope';
import { mergeRefs } from '@solid-primitives/refs';
import {
  CommandMenuEmptyState,
  CommandMenuListItem,
  CommandMenuSearchInput,
  CommandMenuShell,
  cn,
  Dialog,
  Hotkey,
} from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  For,
  type JSX,
  Match,
  on,
  onCleanup,
  onMount,
  type Setter,
  Show,
  Switch,
} from 'solid-js';
import { useAllProperties } from './hooks/useAllProperties';
import { useEntitiesForProperty } from './hooks/useEntitiesForProperty';
import { useSavePropertyForMultiEntitites } from './hooks/useSaveProperties';
import {
  closePropertyEditor,
  propertyEditorOpen,
  propertyEditorState,
  setPropertyEditorMode,
  setPropertyEditorTarget,
  togglePropertyEditor,
} from './state/propertyEditor';

/* Styled wrapper for list items in each menu. */
function ListItem(props: {
  id: string;
  isSelected: boolean;
  as?: 'button' | 'div';
  disabled?: boolean;
  onClick: (event: MouseEvent) => void;
  onMouseEnter: () => void;
  children: JSX.Element;
  class?: string;
}) {
  return (
    <CommandMenuListItem
      as={props.as}
      id={props.id}
      selected={props.isSelected}
      disabled={props.disabled}
      onClick={props.onClick}
      onMouseMove={props.onMouseEnter}
      class={props.class}
    >
      {props.children}
    </CommandMenuListItem>
  );
}

type TagOptionItem = {
  scope: TagScope;
  definition: PropertyDefinitionDetailResponse;
  option: PropertyOptionResponse;
};

type EntityTagIdsByDefinition = Map<string, Map<string, string[]>>;

function tagOptionLabel(option: PropertyOptionResponse): string {
  return option.value.type === 'string' ? option.value.value : '';
}

function tagDefinitionDomain(
  definition: PropertyDefinitionDetailResponse
): PropertyDefinitionDomain {
  return {
    id: definition.id,
    displayName: definition.displayName,
    valueType: 'TAG',
    isMultiSelect: true,
    isMetadata: definition.isMetadata,
    isSystem: definition.isSystem,
    owner: definition,
    createdAt: definition.createdAt ?? new Date().toISOString(),
    updatedAt: definition.updatedAt ?? new Date().toISOString(),
  };
}

function entityTagIdsByDefinition(
  entities: EntityData[],
  fetchedProperties?: { entityId: string; properties: Property[] }
): EntityTagIdsByDefinition {
  const byEntity = new Map<string, Map<string, string[]>>();

  for (const entity of entities) {
    const byDefinition = new Map<string, string[]>();

    if (fetchedProperties?.entityId === entity.id) {
      for (const property of fetchedProperties.properties) {
        if (property.valueType === 'SELECT_STRING' && property.value) {
          byDefinition.set(property.propertyDefinitionId, property.value);
        }
      }
    } else {
      const properties = 'properties' in entity ? entity.properties : undefined;
      for (const property of properties ?? []) {
        if (property.value?.type === 'SelectOption') {
          byDefinition.set(property.definition.id, property.value.value);
        }
      }
    }

    byEntity.set(entity.id, byDefinition);
  }

  return byEntity;
}

function getTagIds(
  byEntity: EntityTagIdsByDefinition,
  entityId: string,
  definitionId: string
) {
  return byEntity.get(entityId)?.get(definitionId) ?? [];
}

function canAssignTags(entity: EntityData): boolean {
  try {
    macroEntityToPropertyEntityType(entity);
    return true;
  } catch {
    return false;
  }
}

export function PropertyEditorModal() {
  const [dialogRef, setDialogRef] = createSignal<HTMLElement | undefined>();
  const [attach, hotkeyScope] = useHotkeyDOMScope('property-editor');
  const [searchValue, setSearchValue] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [inputType, setInputType] = createSignal<'text' | 'number'>('text');

  const defaultPlaceholder = 'Choose a property...';
  const [placeholder, setPlaceholder] = createSignal('');

  const saveProperties = useSavePropertyForMultiEntitites();

  const handlePropertySave = (value: PropertyApiValues) => {
    const { selectedEntities, targetProperty } = propertyEditorState;
    if (!selectedEntities.length || !targetProperty) return;

    // Snapshot before closing — closing resets selectedEntities.
    const count = selectedEntities.length;
    const message = `Set ${targetProperty.displayName} for ${
      count === 1 ? selectedEntities[0].name : count + ' entities'
    }`;

    saveProperties(selectedEntities, targetProperty, value).then((success) => {
      if (success) toast.success(message);
    });
    closePropertyEditor();
  };

  const { dispose: disposeHotkey } = registerHotkey({
    hotkey: ['escape'],
    description: 'Close property editor',
    keyDownHandler: () => {
      closePropertyEditor();
      return true;
    },
    scopeId: hotkeyScope,
  });
  onCleanup(disposeHotkey);

  createEffect(
    on([() => propertyEditorState.mode, propertyEditorOpen], () => {
      setSelectedIndex(0);
      setSearchValue('');
      setPlaceholder('');
      setInputType('text');
    })
  );

  const setSelectedIndexFromMouse = (index: number) => {
    setSelectedIndex(index);
  };

  const keybindings = useListKeyBindings(() => dialogRef());

  return (
    <Dialog
      open={propertyEditorOpen()}
      onOpenChange={togglePropertyEditor}
      contentRef={mergeRefs(attach, setDialogRef)}
    >
      <CommandMenuShell depth={2} class="rounded-xl max-h-108 text-sm">
        <CommandMenuShell.Header>
          <span class="pl-2 text-ink-extra-muted/55 pointer-events-none">
            <PropertiesIcon class="size-3" />
          </span>
          <SearchInput
            placeHolder={placeholder() || defaultPlaceholder}
            value={searchValue}
            setValue={setSearchValue}
            focusedIndex={selectedIndex}
            setFocusedIndex={setSelectedIndex}
            inputType={inputType()}
          />
        </CommandMenuShell.Header>
        <CommandMenuShell.Toolbar class="p-3 py-2 border-b-0">
          <EditingEntityPreview
            entities={propertyEditorState.selectedEntities}
          />
        </CommandMenuShell.Toolbar>
        <CommandMenuShell.Body>
          <Switch>
            <Match when={propertyEditorState.mode === 'selector'}>
              <div class="overflow-scroll scrollbar-hidden">
                <PropertyList
                  searchTerm={searchValue()}
                  focusedIndex={selectedIndex}
                  setFocusedIndex={setSelectedIndex}
                  setFocusedIndexFromMouse={setSelectedIndexFromMouse}
                  setKeybindings={keybindings}
                />
              </div>
            </Match>
            <Match when={propertyEditorState.mode === 'direct'}>
              <PropertyValueEditor
                property={propertyEditorState.targetProperty}
                searchValue={searchValue}
                setSearchValue={setSearchValue}
                selectedIndex={selectedIndex}
                setSelectedIndex={setSelectedIndex}
                setSelectedIndexFromMouse={setSelectedIndexFromMouse}
                setKeybindings={keybindings}
                setPlaceholder={setPlaceholder}
                setInputType={setInputType}
                onSave={handlePropertySave}
              />
            </Match>
            <Match when={propertyEditorState.mode === 'tag'}>
              <TagAssignmentEditor
                entities={propertyEditorState.selectedEntities}
                searchValue={searchValue}
                selectedIndex={selectedIndex}
                setSelectedIndex={setSelectedIndex}
                setSelectedIndexFromMouse={setSelectedIndexFromMouse}
                setKeybindings={keybindings}
                setPlaceholder={setPlaceholder}
              />
            </Match>
          </Switch>
        </CommandMenuShell.Body>
      </CommandMenuShell>
    </Dialog>
  );
}

function SearchInput(props: {
  placeHolder: string;
  setValue: Setter<string>;
  value: Accessor<string>;
  focusedIndex: Accessor<number>;
  setFocusedIndex: Setter<number>;
  onKeyDown?: (e: KeyboardEvent) => void;
  inputType?: 'text' | 'number';
}) {
  let inputRef: HTMLInputElement | undefined;

  onMount(() => {
    inputRef?.focus();
  });

  return (
    <CommandMenuSearchInput
      ref={inputRef}
      type={props.inputType ?? 'text'}
      class="text-base"
      placeholder={props.placeHolder}
      value={props.value()}
      onInput={(e) => props.setValue(e.target.value)}
      onKeyDown={(e) => {
        if (props.onKeyDown) {
          props.onKeyDown(e);
        }
      }}
      autofocus
    />
  );
}

function PropertyList(props: {
  searchTerm: string;
  focusedIndex: Accessor<number>;
  setFocusedIndex: Setter<number>;
  setFocusedIndexFromMouse: (index: number) => void;
  setKeybindings: (navAction: ListNavActions) => void;
}) {
  const properties = useAllProperties();
  let containerRef: HTMLDivElement | undefined;

  const { filteredProperties } = usePropertySelection(
    () => [],
    properties,
    () => props.searchTerm
  );

  const showTagAssignmentOption = createMemo(() => {
    const query = props.searchTerm.toLowerCase().trim();
    return (
      propertyEditorState.selectedEntities.every(canAssignTags) &&
      (!query || 'tags'.includes(query) || 'label'.includes(query))
    );
  });

  const rowCount = () =>
    filteredProperties().length + (showTagAssignmentOption() ? 1 : 0);

  createEffect(() => {
    props.searchTerm;
    props.setFocusedIndex(0);
  });

  props.setKeybindings({
    next: () => {
      const len = rowCount();
      if (len === 0) return;
      props.setFocusedIndex((prev) => (prev + 1) % len);
    },
    previous: () => {
      const len = rowCount();
      if (len === 0) return;
      props.setFocusedIndex((prev) => (prev - 1 + len) % len);
    },
    select: () => {
      if (showTagAssignmentOption() && props.focusedIndex() === 0) {
        setPropertyEditorMode('tag');
        return;
      }

      const focusedProperty =
        filteredProperties()[
          props.focusedIndex() - (showTagAssignmentOption() ? 1 : 0)
        ];
      if (focusedProperty) {
        setProperty(focusedProperty);
      }
    },
  });

  createEffect(() => {
    const index = props.focusedIndex();
    const elem = document.getElementById(
      showTagAssignmentOption() && index === 0
        ? 'property-editor-option-tags'
        : `property-editor-option-${index}`
    );
    if (elem) {
      elem.scrollIntoView({ block: 'nearest' });
    }
  });

  const setProperty = (property: Property | PropertyDefinitionDomain) => {
    setPropertyEditorMode('direct');
    setPropertyEditorTarget(property);
  };

  const selector = createSelector(props.focusedIndex);

  return (
    <Show
      when={rowCount() > 0}
      fallback={
        <CommandMenuEmptyState>
          No matching properties found
        </CommandMenuEmptyState>
      }
    >
      <div
        ref={containerRef}
        class="max-h-54 overflow-y-auto overflow-x-hidden scrollbar-hidden p-2"
      >
        <Show when={showTagAssignmentOption()}>
          <ListItem
            id="property-editor-option-tags"
            isSelected={selector(0)}
            onClick={() => setPropertyEditorMode('tag')}
            onMouseEnter={() => props.setFocusedIndexFromMouse(0)}
            class="scroll-m-2"
          >
            <TagIcon class="size-4 text-ink-muted opacity-50" />
            <div class="flex-1 text-left flex">
              <p class="text-sm font-medium">Tags</p>
            </div>
          </ListItem>
        </Show>
        <For each={filteredProperties()}>
          {(property, index) => (
            <ListItem
              id={`property-editor-option-${index() + (showTagAssignmentOption() ? 1 : 0)}`}
              isSelected={selector(
                index() + (showTagAssignmentOption() ? 1 : 0)
              )}
              onClick={() => setProperty(property)}
              onMouseEnter={() =>
                props.setFocusedIndexFromMouse(
                  index() + (showTagAssignmentOption() ? 1 : 0)
                )
              }
              class="scroll-m-2"
            >
              <PropertyDataTypeIcon property={property} class="opacity-50" />
              <div class="flex-1 text-left flex">
                <p class="text-sm font-medium">{property.displayName}</p>
              </div>
            </ListItem>
          )}
        </For>
      </div>
    </Show>
  );
}

function EditingEntityPreview(props: { entities: EntityData[] }) {
  const displayEntities = () => props.entities.slice(0, 2);
  const remainingCount = () => Math.max(0, props.entities.length - 2);
  return (
    <div class="flex items-center gap-2">
      <For each={displayEntities()}>
        {(entity) => {
          return (
            <div
              class={cn(
                'bg-active border border-edge-muted px-2 py-1 truncate text-xs rounded',
                {
                  'max-w-[50%]': props.entities.length === 2,
                }
              )}
            >
              <InlineEntity entity={entity} />
            </div>
          );
        }}
      </For>
      <Show when={remainingCount() > 0}>
        <div class="text-muted-foreground text-xs px-2 py-1">
          +{remainingCount()} more
        </div>
      </Show>
    </div>
  );
}

function TagAssignmentEditor(props: {
  entities: EntityData[];
  searchValue: Accessor<string>;
  selectedIndex: Accessor<number>;
  setSelectedIndex: Setter<number>;
  setSelectedIndexFromMouse: (index: number) => void;
  setKeybindings: (binding: ListNavActions) => void;
  setPlaceholder: Setter<string>;
}) {
  const tagsQuery = useTagsQuery();
  const currentTeamQuery = useCurrentTeamQuery();
  const addOption = useAddEntityPropertyOptionMutation();
  const removeOption = useRemoveEntityPropertyOptionMutation();
  const [tagEditorMode, setTagEditorMode] =
    createSignal<TagEditorDialogMode | null>(null);
  const [tagEditorOpen, setTagEditorOpen] = createControlledOpenSignal(false, {
    id: 'property-tag-edit',
  });
  const singleEntity = () =>
    props.entities.length === 1 ? props.entities[0] : undefined;
  const entityPropertiesQuery = useEntityPropertiesQuery(
    () => {
      const entity = singleEntity();
      return entity ? macroEntityToPropertyEntityType(entity) : 'DOCUMENT';
    },
    () => singleEntity()?.id ?? '',
    false
  );
  const currentEntityTagIds = () =>
    entityTagIdsByDefinition(
      props.entities,
      singleEntity() && entityPropertiesQuery.data
        ? {
            entityId: singleEntity()!.id,
            properties: entityPropertiesQuery.data,
          }
        : undefined
    );
  const initialEntityTagIds = currentEntityTagIds();
  const [orderedTagIds, setOrderedTagIds] =
    createSignal<EntityTagIdsByDefinition>(initialEntityTagIds);
  const [localTagIds, setLocalTagIds] =
    createSignal<EntityTagIdsByDefinition>(initialEntityTagIds);
  const [hasEditedTags, setHasEditedTags] = createSignal(false);
  let syncedEntityIds = props.entities.map((entity) => entity.id).join('\0');

  createEffect(() => {
    props.setPlaceholder('Change or add tags...');
  });

  createEffect(
    on(
      () => ({
        entityIds: props.entities.map((entity) => entity.id).join('\0'),
        properties: entityPropertiesQuery.data,
      }),
      ({ entityIds }) => {
        const entityIdsChanged = entityIds !== syncedEntityIds;
        if (entityIdsChanged) {
          syncedEntityIds = entityIds;
          setHasEditedTags(false);
        }
        if (hasEditedTags() && !entityIdsChanged) return;

        const nextTagIds = currentEntityTagIds();
        setOrderedTagIds(nextTagIds);
        setLocalTagIds(nextTagIds);
      }
    )
  );

  const teamName = () => currentTeamQuery.data?.team.name?.trim() || 'Team';

  const tagItems = createMemo<TagOptionItem[]>(() => {
    const items: TagOptionItem[] = [];
    for (const set of tagsQuery.data ?? []) {
      if (!set.definition) continue;
      const sortedOptions = [...set.options].sort(
        (a, b) => a.displayOrder - b.displayOrder
      );
      for (const option of sortedOptions) {
        items.push({ scope: set.scope, definition: set.definition, option });
      }
    }
    return items;
  });
  const tagDefinitionsById = createMemo(() => {
    const definitions = new Map<string, PropertyDefinitionDetailResponse>();
    for (const item of tagItems()) {
      definitions.set(item.definition.id, item.definition);
    }
    return definitions;
  });

  const isFullyApplied = (item: TagOptionItem) => {
    if (props.entities.length === 0) return false;
    return props.entities.every((entity) =>
      getTagIds(localTagIds(), entity.id, item.definition.id).includes(
        item.option.id
      )
    );
  };

  const wasFullyAppliedWhenOpened = (item: TagOptionItem) => {
    if (props.entities.length === 0) return false;
    return props.entities.every((entity) =>
      getTagIds(orderedTagIds(), entity.id, item.definition.id).includes(
        item.option.id
      )
    );
  };

  const filteredItems = createMemo(() => {
    const query = props.searchValue().trim().toLowerCase();
    const matchesQuery = (item: TagOptionItem) =>
      !query || tagOptionLabel(item.option).toLowerCase().includes(query);

    const matchingItems = tagItems().filter(matchesQuery);
    const applied = matchingItems.filter(wasFullyAppliedWhenOpened);
    const remaining = matchingItems.filter(
      (item) => !wasFullyAppliedWhenOpened(item)
    );

    return [...applied, ...remaining];
  });
  const createLabel = () => props.searchValue().trim();
  const exactTagMatchExists = () => {
    const label = createLabel().toLowerCase();
    return (
      !!label &&
      tagItems().some(
        (item) => tagOptionLabel(item.option).toLowerCase() === label
      )
    );
  };
  const showCreateRow = () =>
    createLabel().length > 0 && !exactTagMatchExists();
  const hasSearch = () => createLabel().length > 0;
  const hasAnyAppliedTags = () => {
    for (const byDefinition of localTagIds().values()) {
      for (const optionIds of byDefinition.values()) {
        if (optionIds.length > 0) return true;
      }
    }
    return false;
  };
  const showClearAllRow = () => hasAnyAppliedTags();
  const showClearAllAtTop = () => showClearAllRow() && !hasSearch();
  const showClearAllAtBottom = () => showClearAllRow() && hasSearch();
  const itemRowIndex = (index: number) => index + (showClearAllAtTop() ? 1 : 0);
  const createRowIndex = () =>
    filteredItems().length + (showClearAllAtTop() ? 1 : 0);
  const clearAllRowIndex = () =>
    showClearAllAtTop()
      ? 0
      : filteredItems().length + (showCreateRow() ? 1 : 0);
  const rowCount = () =>
    filteredItems().length +
    (showClearAllRow() ? 1 : 0) +
    (showCreateRow() ? 1 : 0);
  const selectedGroupSize = createMemo(
    () => filteredItems().filter(wasFullyAppliedWhenOpened).length
  );

  createEffect(() => {
    props.searchValue();
    props.setSelectedIndex(0);
  });

  createEffect(() => {
    const index = props.selectedIndex();
    const elem = document.getElementById(`tag-assignment-option-${index}`);
    elem?.scrollIntoView({ block: 'nearest' });
  });

  const updateLocalOption = (item: TagOptionItem, remove: boolean) => {
    setLocalTagIds((prev) => {
      const next = new Map(prev);
      for (const entity of props.entities) {
        const byDefinition = new Map(next.get(entity.id) ?? []);
        const current = byDefinition.get(item.definition.id) ?? [];
        byDefinition.set(
          item.definition.id,
          remove
            ? current.filter((id) => id !== item.option.id)
            : current.includes(item.option.id)
              ? current
              : [...current, item.option.id]
        );
        next.set(entity.id, byDefinition);
      }
      return next;
    });
  };

  const toggleTag = async (
    item: TagOptionItem,
    event?: KeyboardEvent | MouseEvent
  ) => {
    const remove = isFullyApplied(item);
    const shouldClose = !event?.shiftKey;
    const previousTagIds = localTagIds();
    setHasEditedTags(true);
    updateLocalOption(item, remove);

    try {
      const update = Promise.all(
        props.entities.map(async (entity) => {
          const entityType = macroEntityToPropertyEntityType(entity);
          const current = getTagIds(
            previousTagIds,
            entity.id,
            item.definition.id
          );
          const hasOption = current.includes(item.option.id);

          if (remove && !hasOption) return;
          if (!remove && hasOption) return;

          const optimisticOptionIds = remove
            ? current.filter((id) => id !== item.option.id)
            : [...current, item.option.id];
          const mutation = remove ? removeOption : addOption;

          await mutation.mutateAsync({
            entityId: entity.id,
            entityType,
            property: tagDefinitionDomain(item.definition),
            optionId: item.option.id,
            optimisticOptionIds,
          });
        })
      );

      if (shouldClose) closePropertyEditor();
      await update;
    } catch (error) {
      if (!shouldClose) {
        setLocalTagIds(previousTagIds);
      }
      console.error('Failed to update tags', error);
    }
  };

  const openCreateTag = () => {
    const label = createLabel();
    if (!showCreateRow() || !label) return;

    setTagEditorMode({
      type: 'create',
      initialScope: currentTeamQuery.data?.team ? 'team' : 'user',
      initialLabel: label,
    });
    setTagEditorOpen(true, false);
  };

  const openEditTag = (item: TagOptionItem) => {
    setTagEditorMode({
      type: 'edit',
      tag: {
        scope: item.scope,
        propertyDefinitionId: item.definition.id,
        option: item.option,
      },
    });
    setTagEditorOpen(true, false);
  };

  const clearAllTags = async (event?: KeyboardEvent | MouseEvent) => {
    if (!showClearAllRow()) return;

    const shouldClose = !event?.shiftKey;
    const previousTagIds = localTagIds();
    setHasEditedTags(true);
    setLocalTagIds(
      new Map(
        props.entities.map((entity) => [entity.id, new Map<string, string[]>()])
      )
    );

    try {
      const updates: Promise<void>[] = [];
      for (const entity of props.entities) {
        const entityType = macroEntityToPropertyEntityType(entity);
        const byDefinition = previousTagIds.get(entity.id) ?? new Map();

        for (const [definitionId, optionIds] of byDefinition) {
          const definition = tagDefinitionsById().get(definitionId);
          if (!definition) continue;

          for (const optionId of optionIds) {
            updates.push(
              removeOption.mutateAsync({
                entityId: entity.id,
                entityType,
                property: tagDefinitionDomain(definition),
                optionId,
                optimisticOptionIds: [],
              })
            );
          }
        }
      }

      if (shouldClose) closePropertyEditor();
      await Promise.all(updates);
    } catch (error) {
      if (!shouldClose) {
        setLocalTagIds(previousTagIds);
      }
      console.error('Failed to clear tags', error);
    }
  };

  const applyCreatedTag = async (
    definition: PropertyDefinitionDetailResponse,
    optionId: string
  ) => {
    const previousTagIds = localTagIds();
    setHasEditedTags(true);
    setLocalTagIds((prev) => {
      const next = new Map(prev);
      for (const entity of props.entities) {
        const byDefinition = new Map(next.get(entity.id) ?? []);
        const current = byDefinition.get(definition.id) ?? [];
        byDefinition.set(
          definition.id,
          current.includes(optionId) ? current : [...current, optionId]
        );
        next.set(entity.id, byDefinition);
      }
      return next;
    });

    try {
      await Promise.all(
        props.entities.map(async (entity) => {
          const entityType = macroEntityToPropertyEntityType(entity);
          const current = getTagIds(previousTagIds, entity.id, definition.id);
          if (current.includes(optionId)) return;

          await addOption.mutateAsync({
            entityId: entity.id,
            entityType,
            property: tagDefinitionDomain(definition),
            optionId,
            optimisticOptionIds: [...current, optionId],
          });
        })
      );
      closePropertyEditor();
    } catch (error) {
      setLocalTagIds(previousTagIds);
      console.error('Failed to apply created tag', error);
    }
  };

  props.setKeybindings({
    next: () => {
      const len = rowCount();
      if (len === 0) return;
      props.setSelectedIndex((prev) => (prev + 1) % len);
    },
    previous: () => {
      const len = rowCount();
      if (len === 0) return;
      props.setSelectedIndex((prev) => (prev - 1 + len) % len);
    },
    select: (event) => {
      if (showClearAllRow() && props.selectedIndex() === clearAllRowIndex()) {
        void clearAllTags(event);
        return;
      }

      if (showCreateRow() && props.selectedIndex() === createRowIndex()) {
        openCreateTag();
        return;
      }

      const item =
        filteredItems()[props.selectedIndex() - (showClearAllAtTop() ? 1 : 0)];
      if (item) void toggleTag(item, event);
    },
  });

  const selector = createSelector(props.selectedIndex);
  const renderClearAllRow = () => (
    <ListItem
      id={`tag-assignment-option-${clearAllRowIndex()}`}
      isSelected={selector(clearAllRowIndex())}
      onClick={(event) => void clearAllTags(event)}
      onMouseEnter={() => props.setSelectedIndexFromMouse(clearAllRowIndex())}
      class="scroll-m-2"
    >
      <CircleDashedEmpty class="size-4 text-ink-muted opacity-50" />
      <span class="min-w-0 flex-1 truncate text-ink-muted">Clear all tags</span>
    </ListItem>
  );

  return (
    <Show
      when={!tagsQuery.isLoading}
      fallback={<CommandMenuEmptyState>Loading tags...</CommandMenuEmptyState>}
    >
      <Show
        when={rowCount() > 0}
        fallback={
          <CommandMenuEmptyState>
            {(tagsQuery.data ?? []).length === 0
              ? 'No tags available'
              : 'No tags match your search'}
          </CommandMenuEmptyState>
        }
      >
        <div class="max-h-54 overflow-y-auto overflow-x-hidden scrollbar-hidden p-2">
          <Show when={showClearAllAtTop()}>{renderClearAllRow()}</Show>
          <For each={filteredItems()}>
            {(item, index) => (
              <>
                <Show
                  when={
                    index() === selectedGroupSize() && selectedGroupSize() > 0
                  }
                >
                  <div class="mx-2 my-1 h-px bg-edge-muted/50" />
                </Show>
                <ListItem
                  as="div"
                  id={`tag-assignment-option-${itemRowIndex(index())}`}
                  isSelected={selector(itemRowIndex(index()))}
                  onClick={(event) => void toggleTag(item, event)}
                  onMouseEnter={() =>
                    props.setSelectedIndexFromMouse(itemRowIndex(index()))
                  }
                  class="scroll-m-2"
                >
                  <OptionCheckBox checked={isFullyApplied(item)} multiselect />
                  <TagDot color={item.option.color ?? undefined} />
                  <span class="min-w-0 flex-1 truncate">
                    {tagOptionLabel(item.option)}
                  </span>
                  <Show when={item.scope === 'team'}>
                    <span class="max-w-30 shrink-0 truncate rounded-full border border-ink/5 px-1.5 py-0.5 text-[10px] leading-none text-ink-extra-muted">
                      {teamName()}
                    </span>
                  </Show>
                  <button
                    type="button"
                    aria-label={`Edit ${tagOptionLabel(item.option)}`}
                    class="ml-1 flex size-5 shrink-0 items-center justify-center rounded text-ink-extra-muted opacity-0 outline-none hover:bg-hover hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openEditTag(item);
                    }}
                  >
                    <PencilIcon class="size-3.5" />
                  </button>
                </ListItem>
              </>
            )}
          </For>
          <Show when={showCreateRow()}>
            <Show when={filteredItems().length > 0}>
              <div class="mx-2 my-1 h-px bg-edge-muted/50" />
            </Show>
            <ListItem
              id={`tag-assignment-option-${createRowIndex()}`}
              isSelected={selector(createRowIndex())}
              onClick={openCreateTag}
              onMouseEnter={() =>
                props.setSelectedIndexFromMouse(createRowIndex())
              }
              class="scroll-m-2"
            >
              <TagIcon class="size-4 text-ink-muted opacity-50" />
              <span class="min-w-0 flex-1 truncate">
                Create new tag "{createLabel()}"
              </span>
            </ListItem>
          </Show>
          <Show when={showClearAllAtBottom()}>
            <Show when={filteredItems().length > 0 || showCreateRow()}>
              <div class="mx-2 my-1 h-px bg-edge-muted/50" />
            </Show>
            {renderClearAllRow()}
          </Show>
        </div>
      </Show>
      <TagEditorDialog
        open={tagEditorOpen()}
        mode={tagEditorMode()}
        teamAvailable={Boolean(currentTeamQuery.data?.team)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          queueMicrotask(() => {
            const selectedRow = document.getElementById(
              `tag-assignment-option-${props.selectedIndex()}`
            );
            if (selectedRow instanceof HTMLElement) {
              selectedRow.focus();
            }
          });
        }}
        onCreateSuccess={async (result) => {
          const definition = result.tagSet.definition;
          if (!definition) return;
          await applyCreatedTag(definition, result.option.id);
        }}
        onClose={() => {
          setTagEditorOpen(false, false);
          setTagEditorMode(null);
        }}
      />
    </Show>
  );
}

function PropertyValueEditor(props: {
  property?: Property | PropertyDefinitionDomain;
  searchValue: Accessor<string>;
  setSearchValue: Setter<string>;
  selectedIndex: Accessor<number>;
  setSelectedIndex: Setter<number>;
  setSelectedIndexFromMouse: (index: number) => void;
  setKeybindings: (binding: ListNavActions) => void;
  setPlaceholder: Setter<string>;
  setInputType: Setter<'text' | 'number'>;
  onSave: (apiValues: PropertyApiValues) => void;
}) {
  const propertyType = () => props.property?.valueType;

  const handleSubmit = (
    value: string | number | boolean | Date | EntityReference
  ) => {
    const type = propertyType();
    if (!type || type === 'TAG') return;
    let apiValues = toPropertyApiValue({ valueType: type }, value);
    if (!apiValues) return;
    props.onSave(apiValues);
  };

  return (
    <Switch>
      <Match
        when={
          propertyType() === 'SELECT_STRING' ||
          propertyType() === 'SELECT_NUMBER'
        }
      >
        <SelectPropertyEditor
          property={props.property!}
          searchValue={props.searchValue}
          selectedIndex={props.selectedIndex}
          setSelectedIndex={props.setSelectedIndex}
          setSelectedIndexFromMouse={props.setSelectedIndexFromMouse}
          onSubmit={handleSubmit}
          setKeybindings={props.setKeybindings}
          setPlaceholder={props.setPlaceholder}
        />
      </Match>
      <Match when={propertyType() === 'ENTITY'}>
        <EntityPropertyEditor
          property={props.property}
          searchValue={props.searchValue}
          setSearchValue={props.setSearchValue}
          selectedIndex={props.selectedIndex}
          setSelectedIndex={props.setSelectedIndex}
          setSelectedIndexFromMouse={props.setSelectedIndexFromMouse}
          onSubmit={handleSubmit}
          setKeybindings={props.setKeybindings}
          setPlaceholder={props.setPlaceholder}
        />
      </Match>
      <Match
        when={
          propertyType() === 'STRING' ||
          propertyType() === 'NUMBER' ||
          propertyType() === 'DATE' ||
          propertyType() === 'BOOLEAN'
        }
      >
        <DirectEditPropertyEditor
          property={props.property}
          searchValue={props.searchValue}
          setSearchValue={props.setSearchValue}
          selectedIndex={props.selectedIndex}
          setSelectedIndex={props.setSelectedIndex}
          setSelectedIndexFromMouse={props.setSelectedIndexFromMouse}
          onSubmit={handleSubmit}
          setKeybindings={props.setKeybindings}
          setPlaceholder={props.setPlaceholder}
          setInputType={props.setInputType}
        />
      </Match>
      <Match when={propertyType() === 'LINK'}>
        <div class="p-4 text-center text-muted-foreground">
          Link editing not yet implemented
        </div>
      </Match>
    </Switch>
  );
}

function SelectPropertyEditor(props: {
  property: Property | PropertyDefinitionDomain;
  searchValue: Accessor<string>;
  selectedIndex: Accessor<number>;
  setSelectedIndex: Setter<number>;
  setSelectedIndexFromMouse: (index: number) => void;
  onSubmit: (value: string) => void;
  setKeybindings: (binding: ListNavActions) => void;
  setPlaceholder: Setter<string>;
}) {
  createEffect(() => {
    if (props.property.isMultiSelect) {
      props.setPlaceholder(
        `Add ${props.property.displayName.toLowerCase()}...`
      );
      return;
    }
    props.setPlaceholder(`Set ${props.property.displayName.toLowerCase()}...`);
  });

  const filteredOptions = createMemo(() => {
    const options = props.property?.options || [];
    const search = props.searchValue().trim();
    if (!search) return options;
    return fuzzyFilter(search, options, (opt) => String(opt.value.value));
  });

  const shouldShowHotkeys = createMemo(() => {
    return !props.searchValue().trim() && filteredOptions().length <= 9;
  });

  props.setKeybindings({
    select: () => {
      const selected = filteredOptions()[props.selectedIndex()];
      props.onSubmit(selected.id);
    },
    next: () => {
      const len = filteredOptions().length;
      props.setSelectedIndex((prev) => (prev + 1) % len);
    },
    previous: () => {
      const len = filteredOptions().length;
      props.setSelectedIndex((prev) => (prev - 1 + len) % len);
    },
  });

  const selector = createSelector(props.selectedIndex);

  return (
    <div class="max-h-54 overflow-y-auto overflow-x-hidden scrollbar-hidden p-2">
      <Show
        when={filteredOptions().length > 0}
        fallback={
          <CommandMenuEmptyState>
            No matching options found
          </CommandMenuEmptyState>
        }
      >
        <For each={filteredOptions()}>
          {(option, index) => (
            <ListItem
              id={`property-value-option-${index()}`}
              isSelected={selector(index())}
              onClick={() => props.onSubmit(option.id)}
              onMouseEnter={() => props.setSelectedIndexFromMouse(index())}
              class="scroll-m-2"
            >
              <PropertyValueIcon optionId={option.id} />
              <div class="flex-1 text-left">
                <p class="text-sm font-medium">{String(option.value.value)}</p>
              </div>
              <Show when={shouldShowHotkeys() && index() < 9}>
                <div class="text-xxs px-1.5 py-0.5 border border-edge-muted text-ink-muted font-mono rounded-xs">
                  <Hotkey shortcut={`${index() + 1}`} />
                </div>
              </Show>
            </ListItem>
          )}
        </For>
      </Show>
    </div>
  );
}

function EntityPropertyEditor(props: {
  property?: Property | PropertyDefinitionDomain;
  searchValue: Accessor<string>;
  setSearchValue: Setter<string>;
  selectedIndex: Accessor<number>;
  setSelectedIndex: Setter<number>;
  setSelectedIndexFromMouse: (index: number) => void;
  onSubmit: (value: EntityReference) => void;
  setKeybindings: (binding: ListNavActions) => void;
  setPlaceholder: Setter<string>;
}) {
  // Company owners are always teammates, so the owner picker offers the
  // team roster instead of the default quick-access people pool (same as
  // the row-cell owner editor in EntityEditor).
  const isCompanyOwner = () => {
    const property = props.property;
    if (!property) return false;
    const definitionId =
      'propertyDefinitionId' in property
        ? property.propertyDefinitionId
        : property.id;
    return definitionId === SYSTEM_PROPERTY_IDS.COMPANY_OWNER;
  };
  const teamQuery = useCurrentTeamQuery();
  const teamMembers = (): IUser[] =>
    (teamQuery.data?.members ?? []).map((member) => ({
      id: member.user_id,
      email: idToEmail(member.user_id),
      name: idToDisplayName(member.user_id),
    }));

  const { entities } = useEntitiesForProperty(
    () => props.property,
    props.searchValue,
    { users: () => (isCompanyOwner() ? teamMembers() : undefined) }
  );

  createEffect(() => {
    const entityTypeLabel =
      props.property?.specificEntityType?.toLowerCase() || 'entity';
    props.setPlaceholder(`Search for ${entityTypeLabel}...`);
  });

  createEffect(() => {
    props.searchValue();
    props.setSelectedIndex(0);
  });

  props.setKeybindings({
    select: () => {
      const selected = entities()[props.selectedIndex()];
      if (selected) {
        const entityRef: EntityReference = {
          entity_id: selected.id,
          entity_type: getEntityType(selected),
        };
        props.onSubmit(entityRef);
      }
    },
    next: () => {
      const len = entities().length;
      props.setSelectedIndex((prev) => (prev + 1) % len);
    },
    previous: () => {
      const len = entities().length;
      props.setSelectedIndex((prev) => (prev - 1 + len) % len);
    },
  });

  createEffect(() => {
    const index = props.selectedIndex();
    const elem = document.getElementById(`entity-option-${index}`);
    if (elem) {
      elem.scrollIntoView({ block: 'nearest' });
    }
  });

  const selector = createSelector(props.selectedIndex);

  return (
    <div class="max-h-54 overflow-y-auto overflow-x-hidden scrollbar-hidden p-2">
      <Show
        when={entities().length > 0}
        fallback={
          <CommandMenuEmptyState>
            {props.searchValue().trim()
              ? 'No matching entities found'
              : 'No entities available'}
          </CommandMenuEmptyState>
        }
      >
        <For each={entities()}>
          {(entity, index) => (
            <ListItem
              id={`entity-option-${index()}`}
              isSelected={selector(index())}
              class="scroll-m-2"
              onClick={() => {
                const entityRef: EntityReference = {
                  entity_id: entity.id,
                  entity_type: getEntityType(entity),
                };
                props.onSubmit(entityRef);
              }}
              onMouseEnter={() => props.setSelectedIndexFromMouse(index())}
            >
              <EntityRowContent entity={entity} />
            </ListItem>
          )}
        </For>
      </Show>
    </div>
  );
}

function EntityRowContent(props: { entity: CombinedEntity }) {
  const { icon } = usePropertyEntityDisplay(
    () => props.entity.id,
    () => getEntityType(props.entity)
  );

  return (
    <>
      <span class="size-4 flex items-center justify-center shrink-0">
        {icon()}
      </span>
      <div class="flex-1 text-left">
        <p class="text-sm font-medium">{getEntityName(props.entity)}</p>
      </div>
    </>
  );
}

function DirectEditPropertyEditor(props: {
  property?: Property | PropertyDefinitionDomain;
  searchValue: Accessor<string>;
  setSearchValue: Setter<string>;
  selectedIndex: Accessor<number>;
  setSelectedIndex: Setter<number>;
  setSelectedIndexFromMouse: (index: number) => void;
  onSubmit: (value: string | number | boolean | Date) => void;
  setKeybindings: (binding: ListNavActions) => void;
  setPlaceholder: Setter<string>;
  setInputType: Setter<'text' | 'number'>;
}) {
  // Show date picker for DATE type properties
  if (props.property?.valueType === 'DATE') {
    return (
      <DatePropertyEditor
        property={props.property}
        searchValue={props.searchValue}
        selectedIndex={props.selectedIndex}
        setSelectedIndex={props.setSelectedIndex}
        setSelectedIndexFromMouse={props.setSelectedIndexFromMouse}
        onSubmit={props.onSubmit as (value: Date) => void}
        setKeybindings={props.setKeybindings}
        setPlaceholder={props.setPlaceholder}
      />
    );
  }

  // Fetch existing property value for single entity
  const singleEntity = () => {
    const entities = propertyEditorState.selectedEntities;
    return entities.length === 1 ? entities[0] : null;
  };

  const entityPropertiesQuery = useEntityPropertiesQuery(
    () => {
      const entity = singleEntity();
      return entity ? macroEntityToPropertyEntityType(entity) : 'DOCUMENT';
    },
    () => singleEntity()?.id ?? '',
    false
  );

  const existingValue = createMemo(() => {
    const entity = singleEntity();
    if (!entity || !props.property) return null;

    const propertyDefId =
      'propertyDefinitionId' in props.property
        ? props.property.propertyDefinitionId
        : props.property.id;

    const entityProperties = entityPropertiesQuery.data;
    if (!entityProperties) return null;

    const prop = entityProperties.find(
      (p) => p.propertyDefinitionId === propertyDefId
    );
    if (!prop) return null;

    if (prop.valueType === 'STRING' || prop.valueType === 'NUMBER') {
      return prop.value;
    }
    return null;
  });

  const handleSubmit = () => {
    const value = props.searchValue();
    const type = props.property?.valueType;

    if (type === 'NUMBER') {
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        props.onSubmit(numValue);
      }
    } else if (type === 'BOOLEAN') {
      props.onSubmit(value.toLowerCase() === 'true');
    } else {
      props.onSubmit(value);
    }
  };

  // Set input type and initial value based on property type
  createEffect(() => {
    const type = props.property?.valueType;
    props.setInputType(type === 'NUMBER' ? 'number' : 'text');
  });

  // Set initial value to existing value when available
  createEffect(() => {
    const existing = existingValue();
    if (existing !== null && existing !== undefined) {
      props.setSearchValue(String(existing));
    }
  });

  createEffect(() => {
    const name = props.property?.displayName || 'value';
    const type = props.property?.valueType;
    const existing = existingValue();

    let placeholderText: string;
    if (existing !== null && existing !== undefined) {
      placeholderText = `${String(existing)}...`;
    } else if (type === 'BOOLEAN') {
      placeholderText = `Enter true or false for ${name}`;
    } else if (type === 'NUMBER') {
      placeholderText = `Enter number for ${name}`;
    } else {
      placeholderText = `Enter ${name}`;
    }

    props.setPlaceholder(placeholderText);
  });

  props.setKeybindings({
    select: () => {
      handleSubmit();
    },
    next: () => {},
    previous: () => {},
  });

  const displayValue = () => {
    const value = props.searchValue().trim();
    return value || null;
  };

  const isValidInput = () => {
    const value = props.searchValue().trim();
    if (!value) return false;
    if (props.property?.valueType === 'NUMBER') {
      return !isNaN(parseFloat(value));
    }
    return true;
  };

  return (
    <div class="max-h-50 overflow-y-auto overflow-x-hidden scrollbar-hidden p-2">
      <ListItem
        id="property-value-option-0"
        isSelected={true}
        disabled={!isValidInput()}
        onClick={handleSubmit}
        onMouseEnter={() => {}}
      >
        <PropertyDataTypeIcon property={props.property!} class="opacity-50" />
        <div class="flex-1 text-left">
          <p class="text-sm font-medium">
            Set {props.property?.displayName}
            <Show when={displayValue()}>
              {' '}
              to <span class="text-ink-muted">{displayValue()}</span>
            </Show>
          </p>
        </div>
      </ListItem>
    </div>
  );
}

function DatePropertyEditor(props: {
  property: Property | PropertyDefinitionDomain;
  searchValue: Accessor<string>;
  selectedIndex: Accessor<number>;
  setSelectedIndex: Setter<number>;
  setSelectedIndexFromMouse: (index: number) => void;
  onSubmit: (value: Date) => void;
  setKeybindings: (binding: ListNavActions) => void;
  setPlaceholder: Setter<string>;
}) {
  createEffect(() => {
    props.setPlaceholder(`Set ${props.property.displayName.toLowerCase()}...`);
  });

  const dateOptions = useDateSearch({
    query: props.searchValue,
  });

  createEffect(
    on(dateOptions, (options) => {
      if (options.length === 0) {
        props.setSelectedIndex(0);
      } else {
        props.setSelectedIndex(
          Math.min(props.selectedIndex(), options.length - 1)
        );
      }
    })
  );

  props.setKeybindings({
    select: () => {
      const selected = dateOptions()[props.selectedIndex()];
      if (selected) {
        props.onSubmit(selected.date);
      }
    },
    next: () => {
      const len = dateOptions().length;
      props.setSelectedIndex((prev) => (prev + 1) % len);
    },
    previous: () => {
      const len = dateOptions().length;
      props.setSelectedIndex((prev) => (prev - 1 + len) % len);
    },
  });

  const selector = createSelector(props.selectedIndex);

  return (
    <>
      <div class="p-2 max-h-54 overflow-y-auto overflow-x-hidden scrollbar-hidden">
        <Show
          when={dateOptions().length > 0}
          fallback={
            <Show
              when={props.searchValue().trim()}
              fallback={
                <CommandMenuEmptyState>
                  Enter a date or duration
                </CommandMenuEmptyState>
              }
            >
              <CommandMenuEmptyState>
                No dates match "{props.searchValue()}"
              </CommandMenuEmptyState>
            </Show>
          }
        >
          <For each={dateOptions()}>
            {(option, index) => (
              <ListItem
                id={`date-option-${index()}`}
                isSelected={selector(index())}
                onClick={() => props.onSubmit(option.date)}
                onMouseEnter={() => props.setSelectedIndexFromMouse(index())}
                class="scroll-m-2"
              >
                <div class="flex-1 text-left">
                  <p class="text-sm font-medium">{option.displayText}</p>
                </div>
                <span class="text-xs text-ink-muted">
                  {option.secondaryText}
                </span>
              </ListItem>
            )}
          </For>
        </Show>
      </div>

      <div class="p-4 border-t border-edge-muted">
        <div class="text-xs text-ink-muted">
          <span>Use queries like </span>
          <code class="bg-active px-1">3d</code>,{' '}
          <code class="bg-active px-1">1w</code>,{' '}
          <code class="bg-active px-1">feb 17</code>, or{' '}
          <code class="bg-active px-1">tomorrow</code>
        </div>
      </div>
    </>
  );
}
