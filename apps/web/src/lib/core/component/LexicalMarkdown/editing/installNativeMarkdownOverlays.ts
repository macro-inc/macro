import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type { Accessor } from 'solid-js';
import { registerNativeChecklist } from '../plugins/checklist/native';
import { dispatchApplicationCommand } from '../plugins/group-b/command';
import { registerNativeTableTouchSelection } from '../plugins/tables/nativeTouchSelection';
import { registerNativeTrailingParagraph } from '../plugins/trailing-paragraph/native';
import type { NativeMarkdownOverlayInstallation } from './nativeOverlayPorts';
import { createNativeListenerScope } from './overlay-hosts/native-listeners';

/** Install only native body capabilities with an actual model action. */
export function installNativeMarkdownOverlays(
  view: EditorView,
  options: { readonly canEdit: Accessor<boolean> }
): NativeMarkdownOverlayInstallation {
  let disposed = false;
  const listeners = createNativeListenerScope();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    listeners.dispose();
  };
  try {
    listeners.add(registerNativeChecklist(view));
    listeners.add(registerNativeTrailingParagraph(view, options.canEdit));
    listeners.add(registerNativeTableTouchSelection(view, options.canEdit));
  } catch (error) {
    disposed = true;
    listeners.fail(error);
  }
  const canFocus = () =>
    !disposed &&
    view.isMounted &&
    options.canEdit() &&
    view.root.contentEditable === 'true';
  return {
    focusAtEnd() {
      if (!canFocus()) return;
      dispatchApplicationCommand(
        view,
        'group-b.focus-end',
        {},
        undefined,
        () => {
          if (canFocus()) view.focus();
        }
      );
    },
    dispose,
  };
}
