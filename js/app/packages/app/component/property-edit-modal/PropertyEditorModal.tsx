import { DialogWrapper } from '@core/component/DialogWrapper';
import { ClippedPanel } from '@core/component/ClippedPanel';
import { Dialog } from '@kobalte/core/dialog';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import {
  type Accessor,
  createMemo,
  createSelector,
  createSignal,
  For,
  Match,
  onCleanup,
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
import CheckIcon from '@icon/regular/check.svg';
import { PROPERTY_STYLES } from '@core/component/Properties/styles';
import { getPropertyDefinitionTypeDisplay } from '@core/component/Properties/utils';
import { EntityData } from '@macro-entity';
import { InlineEntity } from '../../../macro-entity/src/components/InlineEntity';

export function PropertyEditorModal() {
  const [attach, hotkeyScope] = useHotkeyDOMScope('property-editor-modal');
  const [searchValue, setSearchValue] = createSignal('');

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
                        />
                      </div>
                      <div class="p-2 border-b border-edge-muted">
                        <EditingEntityPreview
                          entities={propertyEditorState.selectedEntities}
                        />
                      </div>
                      <div class="overflow-scroll scrollbar-hidden">
                        <PropertyList searchTerm={searchValue()} />
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
}) {
  return (
    <input
      class="flex-1 border-0 outline-none! focus:outline-none ring-0! focus:ring-0"
      placeholder={props.placeHolder}
      value={props.value()}
      onChange={(e) => props.setValue(e.target.value)}
    />
  );
}

function PropertyList(props: { searchTerm: string }) {
  const properties = useAllProperties();

  const { selectedPropertyIds, filteredProperties, togglePropertySelection } =
    usePropertySelection(
      () => [],
      properties,
      () => props.searchTerm
    );

  return (
    <For each={filteredProperties()}>
      {(property) => {
        const selected = () => selectedPropertyIds().has(property.id);
        return (
          <button
            type="button"
            class={cn('w-full px-2.5 py-1.5 text-left')}
            onClick={() => togglePropertySelection(property.id)}
          >
            <div class="flex items-center justify-between">
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <h4 class="font-medium text-xs">{property.displayName}</h4>
                </div>
                <div class="text-xs text-ink-muted mt-0.5">
                  {getPropertyDefinitionTypeDisplay({
                    dataType: property.valueType,
                    specificEntityType: property.specificEntityType,
                    isMultiSelect: property.isMultiSelect,
                  })}
                </div>
              </div>
              <div
                class={`${PROPERTY_STYLES.checkbox.base} border-edge bg-transparent`}
              >
                <Show when={selected()}>
                  <CheckIcon class="w-3 h-3 text-accent" />
                </Show>
              </div>
            </div>
          </button>
        );
      }}
    </For>
  );
}

function EditingEntityPreview(props: { entities: EntityData[] }) {
  const displayEntities = () => props.entities.slice(0, 2);
  const remainingCount = () => Math.max(0, props.entities.length - 2);

  return (
    <div class="flex items-center gap-1">
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
