import { DialogWrapper } from '@core/component/DialogWrapper';
import { ClippedPanel } from '@core/component/ClippedPanel';
import { Dialog } from '@kobalte/core/dialog';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  closePropertyEditor,
  propertyEditorState,
  togglePropertyEditor,
} from './state/propertyEditor';
import { mergeRefs } from '@solid-primitives/refs';
import { beveledCorners } from '../../../block-theme/signals/themeSignals';

// Log immediately when module loads
console.log('[PropertyEditorModal] Module loaded');

export function PropertyEditorModal() {
  console.log('[PropertyEditorModal] Component created');
  const [_containerRef, setContainerRef] = createSignal<HTMLDivElement>();
  const [attach, hotkeyScope] = useHotkeyDOMScope('property-editor-modal');

  onMount(() => {
    const cleanup = registerHotkey({
      hotkey: ['escape'],
      description: 'Close property editor',
      keyDownHandler: () => {
        closePropertyEditor();
        return true;
      },
      scopeId: hotkeyScope,
    });
    onCleanup(() => cleanup.dispose());
  });

  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      closePropertyEditor();
    }
  };

  return (
    <Dialog
      open={propertyEditorState.isOpen}
      onOpenChange={togglePropertyEditor}
    >
      <Portal>
        <Dialog.Overlay class="fixed inset-0" onClick={handleOverlayClick}>
          <DialogWrapper>
            <ClippedPanel tl={!beveledCorners()} active>
              <div
                ref={mergeRefs(attach, setContainerRef)}
                class="flex flex-col h-full min-h-[400px] overflow-hidden"
              ></div>
            </ClippedPanel>
          </DialogWrapper>
        </Dialog.Overlay>
      </Portal>
    </Dialog>
  );
}
