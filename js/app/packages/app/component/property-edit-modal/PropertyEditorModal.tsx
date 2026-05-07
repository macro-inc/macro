import { Dialog, Surface } from '@ui';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
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
import {
  closePropertyEditor,
  propertyEditorOpen,
  propertyEditorState,
  setPropertyEditorMode,
  setPropertyEditorTarget,
  togglePropertyEditor,
} from './state/propertyEditor';
import { useAllProperties } from './hooks/useAllProperties';
import { usePropertySelection } from '@core/component/Properties/hooks';
import { cn } from '@ui';
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';
import type {
  Property,
  PropertyDefinitionDomain,
} from '@core/component/Properties/types';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import { PropertyValueIcon } from '@core/component/Properties/component/propertyValue';
import { Hotkey } from '@core/component/Hotkey';

import { fuzzyFilter } from '@core/util/fuzzy';
import { mergeRefs } from '@solid-primitives/refs';
import {
  macroEntityToPropertyEntityType,
  PropertyDataTypeIcon,
  toPropertyApiValue,
} from '@core/component/Properties/utils';
import { useDateSearch } from '@core/util/dateSearch/useDateSearch';

import { useEntitiesForProperty } from './hooks/useEntitiesForProperty';
import {
  useListKeyBindings,
  type ListNavActions,
} from '@core/util/useListKeyBindings';
import {
  getEntityName,
  getEntityType,
  type CombinedEntity,
} from '@core/component/Properties/component/modal/shared/entityUtils';
import { usePropertyEntityDisplay } from '@core/component/Properties/hooks/usePropertyEntityDisplay';
import type { PropertyApiValues } from '@core/component/Properties/types';
import { toast } from '@core/component/Toast/Toast';
import { useSavePropertyForMultiEntitites } from './hooks/useSaveProperties';
import { useEntityPropertiesQuery } from '@queries/properties/entity';
import { InlineEntity, type EntityData } from '@entity';

/* Styled wrapper for list items in each menu. */
function ListItem(props: {
  id: string;
  isSelected: boolean;
  disabled?: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  children: JSX.Element;
}) {
  return (
    <button
      type="button"
      id={props.id}
      disabled={props.disabled}
      class={cn(
        'flex flex-row w-full justify-between items-center gap-2 py-1.5 px-2 scroll-my-1',
        {
          'bg-active': props.isSelected && !props.disabled,
          'opacity-50 cursor-not-allowed': props.disabled,
        }
      )}
      onClick={props.onClick}
      onMouseEnter={props.onMouseEnter}
    >
      {props.children}
    </button>
  );
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

  const { isKeypressActive } = useIsKeyPressActive();
  const setSelectedIndexFromMouse = (index: number) => {
    if (isKeypressActive()) return;
    setSelectedIndex(index);
  };

  const keybindings = useListKeyBindings(() => dialogRef());

  return (
    <Dialog
      open={propertyEditorOpen()}
      onOpenChange={togglePropertyEditor}
      contentRef={mergeRefs(attach, setDialogRef)}
    >
      <Surface depth={2} active>
        <div class="*:max-h-[75vh]">
          <div class="flex flex-col max-h-108 overflow-hidden text-sm">
            <div class="flex items-center gap-2 bg-panel px-2 h-10 border-b border-edge-muted shrink-0">
              <span class="pl-2 pointer-events-none">❯</span>
              <SearchInput
                placeHolder={placeholder() || defaultPlaceholder}
                value={searchValue}
                setValue={setSearchValue}
                focusedIndex={selectedIndex}
                setFocusedIndex={setSelectedIndex}
                inputType={inputType()}
              />
            </div>
            <div class="p-2 border-b border-edge-muted">
              <EditingEntityPreview
                entities={propertyEditorState.selectedEntities}
              />
            </div>
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
            </Switch>
          </div>
        </div>
      </Surface>
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
    <input
      ref={inputRef}
      type={props.inputType ?? 'text'}
      class="flex-1 text-base border-0 outline-none! focus:outline-none ring-0! focus:ring-0"
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

  createEffect(() => {
    props.searchTerm;
    props.setFocusedIndex(0);
  });

  props.setKeybindings({
    next: () => {
      const len = filteredProperties().length;
      props.setFocusedIndex((prev) => (prev + 1) % len);
    },
    previous: () => {
      const len = filteredProperties().length;
      props.setFocusedIndex((prev) => (prev - 1 + len) % len);
    },
    select: () => {
      const focusedProperty = filteredProperties()[props.focusedIndex()];
      if (focusedProperty) {
        setProperty(focusedProperty);
      }
    },
  });

  createEffect(() => {
    const index = props.focusedIndex();
    const elem = document.getElementById(`property-editor-option-${index}`);
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
      when={filteredProperties().length > 0}
      fallback={
        <div class="text-center py-4 text-ink-muted text-sm">
          No matching properties found
        </div>
      }
    >
      <div
        ref={containerRef}
        class="max-h-50 overflow-y-auto overflow-x-hidden scrollbar-hidden p-1"
      >
        <For each={filteredProperties()}>
          {(property, index) => (
            <ListItem
              id={`property-editor-option-${index()}`}
              isSelected={selector(index())}
              onClick={() => setProperty(property)}
              onMouseEnter={() => props.setFocusedIndexFromMouse(index())}
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
              class={cn('bg-edge px-2 py-1 truncate text-xs rounded-xs', {
                'max-w-[50%]': props.entities.length === 2,
              })}
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
    if (!type) return;
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
    <div class="p-1 max-h-50 overflow-y-auto overflow-x-hidden scrollbar-hidden">
      <Show
        when={filteredOptions().length > 0}
        fallback={
          <div class="text-center py-4 text-ink-muted text-sm">
            No matching options found
          </div>
        }
      >
        <For each={filteredOptions()}>
          {(option, index) => (
            <ListItem
              id={`property-value-option-${index()}`}
              isSelected={selector(index())}
              onClick={() => props.onSubmit(option.id)}
              onMouseEnter={() => props.setSelectedIndexFromMouse(index())}
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
  const { entities } = useEntitiesForProperty(
    () => props.property,
    props.searchValue
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
    <div class="p-1 max-h-50 overflow-y-auto overflow-x-hidden scrollbar-hidden">
      <Show
        when={entities().length > 0}
        fallback={
          <div class="text-center py-4 text-ink-muted text-sm">
            {props.searchValue().trim()
              ? 'No matching entities found'
              : 'No entities available'}
          </div>
        }
      >
        <For each={entities()}>
          {(entity, index) => (
            <ListItem
              id={`entity-option-${index()}`}
              isSelected={selector(index())}
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
    <div class="max-h-50 overflow-y-auto overflow-x-hidden scrollbar-hidden p-1">
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
      <div class="p-1 max-h-50 overflow-y-auto overflow-x-hidden scrollbar-hidden">
        <Show
          when={dateOptions().length > 0}
          fallback={
            <Show
              when={props.searchValue().trim()}
              fallback={
                <div class="text-center py-4 text-ink-muted text-sm">
                  Enter a date or duration
                </div>
              }
            >
              <div class="text-center py-4 text-ink-muted text-sm">
                No dates match "{props.searchValue()}"
              </div>
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

      <div class="px-2 py-1.5 border-t border-edge-muted">
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
