/**
 * @file A plugin allow editors to keep their previous selection when being
 * programmatically focused by element.focus() api.
 */
import { mergeRegister } from '@lexical/utils';
import type { LexicalEditor } from 'lexical';
import { registerRootEventListener } from '../shared';

export function restoreFocusPlugin() {
  // We need to distinguish click-based focus events from programmatic
  // ones (el.focus()). We want to maintain the previous selection (editor.focus)
  // only if we are regaining focus programmatically. If click, let browser handle
  // focus and let lexical catch up.
  let clickFlag = false;
  return (editor: LexicalEditor) => {
    return mergeRegister(
      registerRootEventListener(editor, 'pointerdown', (e: PointerEvent) => {
        clickFlag = true;

        setTimeout(
          () => {
            clickFlag = false;
            // On click, focusin happens synchonously after pointerdown, with the setTimeout flipping the flag back after. This is deterministic and good.
            // On iOS touch these do not happen synchronously, so we're blindly flipping the flag back after 500ms.
          },
          e.pointerType === 'touch' ? 500 : 0
        );
      }),
      registerRootEventListener(editor, 'focusin', (e) => {
        if (clickFlag) return;
        e.preventDefault();
        editor.focus(undefined, { defaultSelection: 'rootStart' });
      })
    );
  };
}
