import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from 'lexical';
import { type Accessor, type JSX, splitProps } from 'solid-js';

export function FocusClickTarget(
  props: {
    editor: LexicalEditor;
    editorFocus?: Accessor<boolean>;
  } & JSX.HTMLAttributes<HTMLDivElement>
) {
  const [local, divProps] = splitProps(props, ['editor', 'editorFocus']);
  return (
    <div
      onMouseDown={(e: MouseEvent) => {
        e.preventDefault(); // this div should not take focus.
      }}
      classList={{
        'invisible-focus-target': true,
      }}
      onClick={(e: MouseEvent) => {
        e.preventDefault();
        if (!local.editor.isEditable()) return;
        local.editor.update(() => {
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
        local.editor.focus();
      }}
      {...divProps} // Spread the rest of the props to the div
    />
  );
}
