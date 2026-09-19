import { $createParagraphNode, $getRoot, $isParagraphNode } from 'lexical';

/**
 * Move the caret to the end of the editor content, ensuring it lands on its
 * own paragraph when the content ends in a non-paragraph block.
 *
 * Restoring an explicit reply can leave its decorator as the final block — the
 * markdown importer drops whitespace-only trailing paragraphs and parks the
 * caret at the start of the content — so typing would extend the quote
 * block itself. Appending an empty paragraph puts the caret on a fresh line
 * below the reference instead. Content that already ends in a paragraph (e.g. an
 * existing draft) keeps its shape, with the caret at the end of it.
 *
 * Must be called inside `editor.update()`.
 */
export function $selectTrailingParagraph(): void {
  const lastChild = $getRoot().getLastChild();
  if ($isParagraphNode(lastChild)) {
    lastChild.selectEnd();
    return;
  }
  const paragraph = $createParagraphNode();
  $getRoot().append(paragraph);
  paragraph.selectEnd();
}
