import { $isListItemNode, type ListItemNode } from '@lexical/list';
import { $isImageNode, type ImageNode } from '@macro-inc/lexical-core';
import {
  $findMatchingParent,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_NORMAL,
  INSERT_PARAGRAPH_COMMAND,
  type LexicalEditor,
} from 'lexical';

function $selectedListItem(): ListItemNode | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  return $findMatchingParent(selection.anchor.getNode(), $isListItemNode);
}

/** The item whose text ends right above `item`: its previous sibling, or that sibling's last nested item. */
function $itemAbove(item: ListItemNode): ListItemNode | null {
  const previous = item.getPreviousSibling();
  if (!$isListItemNode(previous)) return null;
  const last = previous.getLastDescendant();
  if (!last) return previous;
  return $findMatchingParent(last, $isListItemNode);
}

/**
 * Inserts an image into the list the caret is in, under the current item,
 * without splitting the list. On the empty item Enter leaves after an item,
 * the image goes under the item above and the caret stays on the empty item,
 * so a second Enter leaves the list as usual and an image inserted then sits
 * below the list. Returns false when the caret is not in a list.
 */
export function $insertImageIntoListItem(image: ImageNode): boolean {
  const item = $selectedListItem();
  if (!item) return false;
  if (!item.isEmpty()) {
    item.append(image);
    return true;
  }
  const above = $itemAbove(item);
  if (!above) return false;
  above.append(image);
  return true;
}

function $trailingImages(item: ListItemNode): ImageNode[] {
  const images: ImageNode[] = [];
  let child = item.getLastChild();
  while (child && $isImageNode(child)) {
    images.unshift(child);
    child = child.getPreviousSibling();
  }
  return images;
}

/**
 * Enter in an item with images under it starts the next item below the
 * images, keeping them with the item they belong to. Lexical would otherwise
 * carry the images into the new item.
 */
function $insertParagraphAboveImages(): boolean {
  const item = $selectedListItem();
  if (!item) return false;
  const images = $trailingImages(item);
  if (images.length === 0) return false;
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  for (const image of images) image.remove();
  selection.insertParagraph();
  item.append(...images);
  return true;
}

export function registerListItemImages(editor: LexicalEditor) {
  return editor.registerCommand(
    INSERT_PARAGRAPH_COMMAND,
    $insertParagraphAboveImages,
    COMMAND_PRIORITY_NORMAL
  );
}
