import { DialogWrapper } from '@core/component/DialogWrapper';
import { ClippedPanel } from '@core/component/ClippedPanel';
import { Dialog } from '@kobalte/core/dialog';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import { onCleanup } from 'solid-js';
import {
  closePropertyEditor,
  propertyEditorOpen,
  togglePropertyEditor,
} from './state/propertyEditor';
import { mergeRefs } from '@solid-primitives/refs';
import { beveledCorners } from '../../../block-theme/signals/themeSignals';

// Log immediately when module loads
console.log('[PropertyEditorModal] Module loaded');

export function PropertyEditorModal() {
  console.log('[PropertyEditorModal] Component created');
  const [attach, hotkeyScope] = useHotkeyDOMScope('property-editor-modal');

  const hk = registerHotkey({
    hotkey: ['escape'],
    description: 'Close property editor',
    keyDownHandler: () => {
      closePropertyEditor();
      return true;
    },
    scopeId: hotkeyScope,
  });

  onCleanup(() => hk.dispose());

  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      closePropertyEditor();
    }
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
                  <input placeholder="props" />
                </div>
              </ClippedPanel>
            </Dialog.Content>
          </div>
        </DialogWrapper>
      </Dialog.Portal>
    </Dialog>
  );
}
