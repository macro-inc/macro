import { DialogWrapper } from '@core/component/DialogWrapper';
import { ClippedPanel } from '@core/component/ClippedPanel';
import { Dialog } from '@kobalte/core/dialog';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import {
  type Accessor,
  createEffect,
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
  togglePropertyEditor,
} from './state/propertyEditor';
import { mergeRefs } from '@solid-primitives/refs';
import { beveledCorners } from '../../../block-theme/signals/themeSignals';
import { useAllProperties } from './hooks/useAllProperties';
import { usePropertySelection } from '@core/component/Properties/hooks';
import { cn } from '@ui/utils/classname';
import type { EntityData } from '@macro-entity';
import { InlineEntity } from '../../../macro-entity/src/components/InlineEntity';

export function PropertyEditorModal() {
  const [attach, hotkeyScope] = useHotkeyDOMScope('property-editor-modal');
  const [searchValue, setSearchValue] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);

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

  const handleOverlayClick = () => {
    closePropertyEditor();
  };

  createEffect(
    on(
      () => propertyEditorState.mode,
      () => {
        setSelectedIndex(0);
        setSearchValue('');
      }
    )
  );

  return (
    <Dialog open={propertyEditorOpen()} onOpenChange={togglePropertyEditor}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0" onClick={handleOverlayClick} />
        <DialogWrapper>
          <div ref={mergeRefs(attach)}>
            <Dialog.Content>
              <ClippedPanel tl={!beveledCorners()} active>
                <div class="flex flex-col max-h-108 overflow-hidden bracket-never">
                  <Switch>
                    <Match when={propertyEditorState.mode === 'selector'}>
                      <div class="flex items-center gap-2 bg-panel px-2 h-[40px] border-b border-edge-muted shrink-0">
                        <span class="pl-2 pointer-events-none">❯</span>
                        <SearchInput
                          placeHolder="Search Properties"
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
                      <div class="overflow-scroll scrollbar-hidden p-2">
                        <PropertyList
                          searchTerm={searchValue()}
                          focusedIndex={selectedIndex}
                          setFocusedIndex={setSelectedIndex}
                        />
                      </div>
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
}) {
  let inputRef: HTMLInputElement | undefined;

  onMount(() => {
    inputRef?.focus();
  });

  return (
    <input
      ref={inputRef}
      class="flex-1 border-0 outline-none! focus:outline-none ring-0! focus:ring-0"
      placeholder={props.placeHolder}
      value={props.value()}
      onInput={(e) => props.setValue(e.target.value)}
      autofocus
    />
  );
}

function PropertyList(props: {
  searchTerm: string;
  focusedIndex: Accessor<number>;
  setFocusedIndex: Setter<number>;
}) {
  const properties = useAllProperties();
  let containerRef: HTMLDivElement | undefined;
  let searchInputRef: HTMLInputElement | undefined;

  const { filteredProperties, togglePropertySelection } = usePropertySelection(
    () => [],
    properties,
    () => props.searchTerm
  );

  // Reset focused index when search term changes
  createEffect(() => {
    props.searchTerm;
    props.setFocusedIndex(0);
  });

  // Handle keyboard navigation from input
  createEffect(() => {
    searchInputRef = document.querySelector(
      'input[placeholder="Search Properties"]'
    ) as HTMLInputElement;

    const handleKeyDown = (e: KeyboardEvent) => {
      const items = filteredProperties();
      if (!items.length) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          props.setFocusedIndex((prev) => (prev + 1) % items.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          props.setFocusedIndex(
            (prev) => (prev - 1 + items.length) % items.length
          );
          break;
        case 'Enter':
          e.preventDefault();
          const focusedProperty = items[props.focusedIndex()];
          if (focusedProperty) {
            togglePropertySelection(focusedProperty.id);
          }
          break;
      }
    };

    if (searchInputRef) {
      searchInputRef.addEventListener('keydown', handleKeyDown);
      onCleanup(() =>
        searchInputRef?.removeEventListener('keydown', handleKeyDown)
      );
    }
  });

  // Scroll focused item into view
  createEffect(() => {
    const index = props.focusedIndex();
    if (containerRef) {
      const buttons = containerRef.querySelectorAll('button');
      const focusedButton = buttons[index];
      if (focusedButton) {
        focusedButton.scrollIntoView({ block: 'nearest' });
      }
    }
  });

  const selector = createSelector(props.focusedIndex);

  return (
    <Show
      when={filteredProperties().length > 0}
      fallback={<div class="px-2 py-1">No matching properties found</div>}
    >
      <div ref={containerRef}>
        <For each={filteredProperties()}>
          {(property, index) => {
            return (
              <button
                type="button"
                class={cn('w-full px-2.5 py-1.5 text-left scroll-m-2', {
                  'bg-edge/20 bracket': selector(index()),
                  'hover:bg-edge/10': !selector(index()),
                })}
                onClick={() => togglePropertySelection(property.id)}
                onMouseEnter={() => props.setFocusedIndex(index())}
              >
                <div class="flex items-center justify-between">
                  <div class="flex-1">
                    <div class="flex items-center gap-2">
                      <p>{property.displayName}</p>
                    </div>
                  </div>
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
        <div class="text-sm text-muted-foreground px-2 py-1">
          +{remainingCount()} more
        </div>
      </Show>
    </div>
  );
}
