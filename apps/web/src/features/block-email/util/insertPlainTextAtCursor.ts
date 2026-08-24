import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from 'lexical';

/**
 * Inserts multi-line plain text at the editor's last cursor position (Lexical
 * keeps its selection while the editor is blurred, e.g. while a toolbar menu
 * is open), falling back to the end of the document when the editor has never
 * had a cursor. `insertRawText` turns newlines into line breaks.
 */
export function insertPlainTextAtCursor(editor: LexicalEditor, text: string) {
  editor.update(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      selection.insertRawText(text);
    } else {
      $getRoot().selectEnd().insertRawText(text);
    }
  });
  editor.focus();
}
