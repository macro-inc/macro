import { $selectDocumentStart } from '@core/component/LexicalMarkdown/plugins/block-decorator-navigation';
import {
  $getCaretRect,
  isRectFlushWith,
} from '@core/component/LexicalMarkdown/utils';
import { mergeRegister } from '@lexical/utils';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_NORMAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
} from 'lexical';
import type { Accessor } from 'solid-js';

/**
 * Use the plugin architecture to set up command handlers on both the
 * title editor and the main editor. Pressing enter or the arrows can
 * trigger navigation between the two editors if certain conditions are met.
 * TODO (seamus): Consider making more robust if we get into a situation
 *     where there are three or more editors on one page.
 */
export function titleNavigationPlugin(
  documentEditor: LexicalEditor,
  ignoreArrows: Accessor<boolean>
) {
  return (titleEditor: LexicalEditor) =>
    mergeRegister(
      // Press enter in the title editor.
      titleEditor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (!event) return false;
          if (ignoreArrows()) return true;
          event?.preventDefault();
          // The title is a field of its own: an editor writes its caret only
          // where focus is, so move focus to the body first.
          documentEditor.getRootElement()?.focus({ preventScroll: true });
          // Prepend a new paragraph to the main editor.
          documentEditor.update(() => {
            const root = $getRoot();
            const firstChild = root.getFirstChild();
            const paragraph = $createParagraphNode();
            paragraph.append($createTextNode(''));
            firstChild
              ? firstChild.insertBefore(paragraph)
              : root.append(paragraph);
            paragraph.selectEnd();
          });
          return true;
        },
        COMMAND_PRIORITY_NORMAL
      ),
      // Press arrow down in the title editor.
      titleEditor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event: KeyboardEvent) => {
          if (ignoreArrows()) return true;
          const rect = titleEditor.getRootElement()?.getBoundingClientRect();
          if (!rect) return false;
          const caret = $getCaretRect() ?? rect;
          if (!isRectFlushWith(caret, rect, 'bottom', 5)) return false;

          event?.preventDefault();
          // A node selection places no DOM caret, so focus the body first.
          documentEditor.getRootElement()?.focus({ preventScroll: true });
          documentEditor.update($selectDocumentStart);
          return true;
        },
        COMMAND_PRIORITY_NORMAL
      ),
      // Press right from the end of the title.
      titleEditor.registerCommand(
        KEY_ARROW_RIGHT_COMMAND,
        (event: KeyboardEvent) => {
          if (ignoreArrows()) return true;
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed())
            return false;
          const anchorNode = selection.anchor.getNode();
          const len = anchorNode.getTextContent().length;
          if (selection.anchor.offset !== len) return false;
          if (anchorNode.getParent()?.getLastChild() !== anchorNode)
            return false;

          event?.preventDefault();
          // A node selection places no DOM caret, so focus the body first.
          documentEditor.getRootElement()?.focus({ preventScroll: true });
          documentEditor.update($selectDocumentStart);
          return true;
        },
        COMMAND_PRIORITY_NORMAL
      ),
      // Press tab in the title. Without this the browser moves focus to the
      // tag controls below the title instead of the body.
      titleEditor.registerCommand(
        KEY_TAB_COMMAND,
        (event: KeyboardEvent) => {
          if (ignoreArrows()) return true;
          if (event.shiftKey) return false;

          event.preventDefault();
          documentEditor.getRootElement()?.focus({ preventScroll: true });
          documentEditor.update($selectDocumentStart);
          return true;
        },
        COMMAND_PRIORITY_NORMAL
      )
    );
}
