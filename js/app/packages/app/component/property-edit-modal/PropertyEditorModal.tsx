import { DialogWrapper } from '@core/component/DialogWrapper';
import { ClippedPanel } from '@core/component/ClippedPanel';
import { Dialog } from '@kobalte/core/dialog';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  For,
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
import { beveledCorners } from '../../../block-theme/signals/themeSignals';
import { useAllProperties } from './hooks/useAllProperties';
import { usePropertySelection } from '@core/component/Properties/hooks';
import { cn } from '@ui/utils/classname';
import type { EntityData } from '@macro-entity';
import { InlineEntity } from '../../../macro-entity/src/components/InlineEntity';
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';
import type {
  Property,
  PropertyDefinitionDomain,
} from '@core/component/Properties/types';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import { PropertyValueIcon } from '@core/component/Properties/component/propertyValue';
import { Hotkey } from '@core/component/Hotkey';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import { fuzzyFilter } from '@core/util/fuzzy';
import { mergeRefs } from '@solid-primitives/refs';
import { PropertyDataTypeIcon } from '@core/component/Properties/utils';

type ListNavActions = {
  next: VoidFunction;
  previous: VoidFunction;
  select: VoidFunction;
};

function createListKeybindings(elem: Accessor<HTMLElement | undefined>) {
  let actions: ListNavActions | undefined;
  let unbind: VoidFunction | undefined;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'j' && e.ctrlKey)) {
      e.preventDefault();
      actions?.next();
    } else if (e.key === 'ArrowUp' || (e.key === 'k' && e.ctrlKey)) {
      e.preventDefault();
      actions?.previous();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      actions?.select();
    }
  };

  createEffect(
    on(elem, (el) => {
      unbind?.();
      if (!el) return;
      el.addEventListener('keydown', onKeyDown);
      unbind = () => el.removeEventListener('keydown', onKeyDown);
    })
  );

  onCleanup(() => unbind?.());

  return (nextActions: ListNavActions | undefined) => {
    actions = nextActions;
  };
}

export function PropertyEditorModal() {
  const [dialogRef, setDialogRef] = createSignal<HTMLElement>();
  const [attach, hotkeyScope] = useHotkeyDOMScope('property-editor-modal');
  const [searchValue, setSearchValue] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  const defaultPlaceholder = 'Choose a property...';
  const [placeholder, setPlaceholder] = createSignal('');

  const { dispose } = registerHotkey({
    hotkey: ['escape'],
    description: 'Close property editor',
    keyDownHandler: () => {
      closePropertyEditor();
      return true;
    },
    scopeId: hotkeyScope,
  });
  onCleanup(dispose);

  createEffect(
    on(
      () => propertyEditorState.mode,
      () => {
        setSelectedIndex(0);
        setSearchValue('');
        setPlaceholder('');
      }
    )
  );

  const { isKeypressActive } = useIsKeyPressActive();
  const setSelectedIndexFromMouse = (index: number) => {
    if (isKeypressActive()) return;
    setSelectedIndex(index);
  };

  const keybindings = createListKeybindings(dialogRef);

  return (
    <Dialog open={propertyEditorOpen()} onOpenChange={togglePropertyEditor}>
      <Dialog.Portal>
        <Dialog.Overlay
          class="fixed inset-0"
          onClick={() => closePropertyEditor()}
        />
        <DialogWrapper>
          <div ref={mergeRefs(attach, setDialogRef)}>
            <Dialog.Content>
              <ClippedPanel tl={!beveledCorners()} active>
                <div class="flex flex-col max-h-108 overflow-hidden bracket-never text-sm">
                  <div class="flex items-center gap-2 bg-panel px-2 h-[40px] border-b border-edge-muted shrink-0">
                    <span class="pl-2 pointer-events-none">❯</span>
                    <SearchInput
                      placeHolder={placeholder() || defaultPlaceholder}
                      value={searchValue}
                      setValue={setSearchValue}
                      focusedIndex={selectedIndex}
                      setFocusedIndex={setSelectedIndex}
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
                      />
                    </Match>
                  </Switch>
                </div>
              </ClippedPanel>
            </Dialog.Content>
          </div>
        </DialogWrapper>
      </Dialog.Portal>
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
}) {
  let inputRef: HTMLInputElement | undefined;

  onMount(() => {
    inputRef?.focus();
  });

  return (
    <input
      ref={inputRef}
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
        class="max-h-[200px] overflow-y-auto overflow-x-hidden scrollbar-hidden p-1"
      >
        <For each={filteredProperties()}>
          {(property, index) => {
            return (
              <button
                type="button"
                id={`property-editor-option-${index()}`}
                class={cn(
                  'flex flex-row w-full justify-between items-center gap-2 py-1.5 px-2',
                  {
                    'bg-hover bracket': selector(index()),
                  }
                )}
                onClick={() => setProperty(property)}
                onMouseEnter={() => props.setFocusedIndexFromMouse(index())}
              >
                <PropertyDataTypeIcon property={property} class="opacity-50" />
                <div class="flex-1 text-left flex">
                  <p class="text-sm font-medium">{property.displayName}</p>
                </div>
              </button>
            );
          }}
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
              class={cn('bg-edge/20 px-2 py-1 truncate', {
                'max-w-[50%]': props.entities.length === 2,
              })}
            >
              <InlineEntity entity={entity} />
            </div>
          );
        }}
      </For>
      <Show when={remainingCount() > 0}>
        <div class="text-muted-foreground px-2 py-1">
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
}) {
  const propertyType = () => props.property?.valueType;

  const handleSubmit = (value: any) => {
    console.log('Submitting property:', props.property, 'with value:', value);
    closePropertyEditor();
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
          onSubmit={handleSubmit}
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
          onSubmit={handleSubmit}
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
      props.onSubmit(selected.value.value.toString());
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
    <div class="p-1 max-h-[200px] overflow-y-auto overflow-x-hidden scrollbar-hidden">
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
            <button
              type="button"
              id={`property-value-option-${index()}`}
              class={cn(
                'flex flex-row w-full justify-between items-center gap-2 py-1.5 px-2',
                {
                  'bg-hover bracket': selector(index()),
                }
              )}
              onClick={() => props.onSubmit(option.id)}
              onMouseEnter={() => props.setSelectedIndexFromMouse(index())}
            >
              <PropertyValueIcon optionId={option.id} />
              <div class="flex-1 text-left">
                <p class="text-sm font-medium">{String(option.value.value)}</p>
              </div>
              <Show when={shouldShowHotkeys() && index() < 9}>
                <div class="text-[0.625rem] px-1.5 py-0.5 border border-edge-muted text-ink-muted font-mono rounded-xs">
                  <Hotkey shortcut={`${index() + 1}`} />
                </div>
              </Show>
            </button>
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
  onSubmit: (value: EntityReference) => void;
}) {
  // TODO: Implement entity search/selection logic
  // This would typically use an entity search query

  return (
    <>
      <div class="flex w-full items-center py-1 gap-2 px-2 border-b border-edge-muted shrink-0">
        <SearchIcon class="h-4 w-4 text-ink-muted" />
        <SearchInput
          placeHolder={`Search for ${props.property?.displayName}...`}
          value={props.searchValue}
          setValue={props.setSearchValue}
          focusedIndex={props.selectedIndex}
          setFocusedIndex={props.setSelectedIndex}
        />
      </div>
      <div class="p-4 text-center text-ink-muted text-sm">
        Entity search coming soon
        {/* TODO: Implement entity search results list */}
      </div>
    </>
  );
}

function DirectEditPropertyEditor(props: {
  property?: Property | PropertyDefinitionDomain;
  searchValue: Accessor<string>;
  setSearchValue: Setter<string>;
  onSubmit: (value: string | number | boolean | Date) => void;
}) {
  let inputRef: HTMLInputElement | undefined;

  onMount(() => {
    inputRef?.focus();
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
    } else if (type === 'DATE') {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        props.onSubmit(date);
      }
    } else {
      props.onSubmit(value);
    }
  };

  const getInputType = () => {
    switch (props.property?.valueType) {
      case 'NUMBER':
        return 'number';
      case 'DATE':
        return 'datetime-local';
      default:
        return 'text';
    }
  };

  const getPlaceholder = () => {
    const name = props.property?.displayName || 'value';
    switch (props.property?.valueType) {
      case 'BOOLEAN':
        return `Enter true or false for ${name}`;
      case 'NUMBER':
        return `Enter number for ${name}`;
      case 'DATE':
        return `Enter date for ${name}`;
      default:
        return `Enter ${name}`;
    }
  };

  return (
    <>
      <div class="flex w-full items-center py-1 gap-2 px-2 border-b border-edge-muted shrink-0">
        <input
          ref={inputRef}
          class="w-full caret-accent"
          type={getInputType()}
          placeholder={getPlaceholder()}
          value={props.searchValue()}
          onInput={(e) => props.setSearchValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSubmit();
            }
          }}
          autofocus
        />
      </div>
      <div class="p-2 border-t border-edge-muted">
        <button
          type="button"
          class="flex items-center justify-center w-full px-3 py-2 bg-hover text-sm font-medium"
          onClick={handleSubmit}
        >
          Set Value
        </button>
      </div>
    </>
  );
}
