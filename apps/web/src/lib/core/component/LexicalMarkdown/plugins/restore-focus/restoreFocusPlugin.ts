/**
 * @file A plugin allow editors to keep their previous selection when being
 * programmatically focused by element.focus() api.
 */
import { mergeRegister } from '@lexical/utils';
import { $getRoot, $getSelection, type LexicalEditor } from 'lexical';
import { registerRootEventListener } from '../shared';

/** Where programmatic focus puts the caret when the editor has no selection. */
export type RestoreFocusDefault = 'rootStart' | 'rootEnd';

export function restoreFocusPlugin(
  defaultSelection: RestoreFocusDefault = 'rootStart'
) {
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
        // Embedded controls and editors own their focus, even though their
        // focusin event bubbles through the outer editor root.
        if (e.target !== editor.getRootElement()) return;
        if (clickFlag) return;
        e.preventDefault();
        // Native focus has already put the DOM caret at the start, and an
        // editor without a selection would adopt it; apply the default instead.
        const hadSelection = editor
          .getEditorState()
          .read(() => $getSelection() !== null);
        if (!hadSelection) {
          editor.update(() => {
            if (defaultSelection === 'rootEnd') $getRoot().selectEnd();
            else $getRoot().selectStart();
          });
        }
        editor.focus(undefined, { defaultSelection });
      })
    );
  };
}
