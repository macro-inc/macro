import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { registerNativeChecklist } from '../plugins/checklist/native';
import { dispatchApplicationCommand } from '../plugins/group-b/command';
import type { NativeMarkdownOverlayInstallation } from './nativeOverlayPorts';

/** Install only native body capabilities with an actual model action. */
export function installNativeMarkdownOverlays(
  view: EditorView
): NativeMarkdownOverlayInstallation {
  const releaseChecklist = registerNativeChecklist(view);
  let disposed = false;
  const canFocus = () =>
    !disposed && view.isMounted && view.root.contentEditable === 'true';
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
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseChecklist();
    },
  };
}
