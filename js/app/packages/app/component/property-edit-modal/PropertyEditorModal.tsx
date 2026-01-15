import { DialogWrapper } from '@core/component/DialogWrapper';
import { ClippedPanel } from '@core/component/ClippedPanel';
import { Dialog } from '@kobalte/core/dialog';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import {
  Accessor,
  createMemo,
  createSignal,
  onCleanup,
  Setter,
} from 'solid-js';
import {
  closePropertyEditor,
  propertyEditorOpen,
  togglePropertyEditor,
} from './state/propertyEditor';
import { mergeRefs } from '@solid-primitives/refs';
import { beveledCorners } from '../../../block-theme/signals/themeSignals';

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
                <div class="flex flex-col h-[400px] overflow-hidden bracket-never">
                  <div class="flex items-center gap-2 bg-panel px-2 h-[40px] border-b border-edge-muted">
                    <span class="pl-2 pointer-events-none">❯</span>
                    <SearchInput
                      placeHolder="Search Properties"
                      value={searchValue}
                      setValue={setSearchValue}
                    />
                  </div>
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
  const listPropertiesQuery = useListPropertiesQuery(() => ({
    scope: 'all',
    includeOptions: true,
    forEntityType: entityType,
  }));

  const availableProperties = createMemo((): PropertyDefinitionDomain[] => {
    if (
      listPropertiesQuery.isLoading ||
      listPropertiesQuery.isError ||
      !listPropertiesQuery.data
    ) {
      return [];
    }

    const data = listPropertiesQuery.data;

    const properties = Array.isArray(data) ? data : [];
    return properties.map((item) => {
      if ('definition' in item) {
        return toPropertyDefinitionDomain(
          item.definition,
          item.property_options || []
        );
      }
      return toPropertyDefinitionDomain(item);
    });
  });
}
