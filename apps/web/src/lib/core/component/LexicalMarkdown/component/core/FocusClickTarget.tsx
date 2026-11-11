import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from 'lexical';
import { type Accessor, type JSX, splitProps } from 'solid-js';
import type { NativeFocusTarget } from '../../editing/overlay-hosts/focus';

export function FocusClickTarget(
  props: {
    editor?: LexicalEditor;
    native?: NativeFocusTarget;
    editorFocus?: Accessor<boolean>;
  } & JSX.HTMLAttributes<HTMLDivElement>
) {
  const [local, divProps] = splitProps(props, [
    'editor',
    'editorFocus',
    'native',
  ]);
  return (
    <div
      onMouseDown={(e: MouseEvent) => {
        // don't prevent default when there's an active selection
        // since the expected behavior is that it unselects
        let hasActiveSelection = false;
        local.editor?.getEditorState().read(() => {
          const sel = $getSelection();
          hasActiveSelection = $isRangeSelection(sel) && !sel.isCollapsed();
        });
        if (local.native) hasActiveSelection = local.native.hasSelection();
        if (!hasActiveSelection) {
          e.preventDefault();
        }
      }}
      onClick={(e: MouseEvent) => {
        e.preventDefault();
        if (local.native) {
          if (local.native.editable()) local.native.focusAtEnd();
          return;
        }
        const editor = local.editor;
        if (!editor?.isEditable()) return;
        editor.update(() => {
          const sel = $getSelection();
          // dont move selection if there is already a valid, focuses selection
          if (local.editorFocus?.() && $isRangeSelection(sel)) {
            return;
          }
          const root = $getRoot();
          const lastChild = root.getLastChild();
          if (lastChild === null) return;
          if (lastChild.getType() === 'paragraph') {
            if (lastChild.getTextContent() === '') {
              root.selectEnd();
              return;
            }
          }
          root.append($createParagraphNode());
          root.selectEnd();
        });
        editor.focus();
      }}
      {...divProps} // Spread the rest of the props to the div
    />
  );
}
