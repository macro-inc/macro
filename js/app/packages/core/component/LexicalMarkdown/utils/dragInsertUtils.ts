import {
  $createDocumentMentionNode,
  type DocumentMentionInfo,
} from '@lexical-core';
import {
  $createParagraphNode,
  $getNodeByKey,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from 'lexical';
import type { SetStoreFunction } from 'solid-js/store';
import {
  calculateInsertPoint,
  type DragInsertState,
  type InsertionMarker,
} from '../plugins/drag-insert/dragInsertPlugin';

const DRAG_INSERT_COLLISION_PADDING = 8;

export type DragInsertCoordinates = {
  clientX: number;
  clientY: number;
};

export type ValidDragInsertPosition = {
  key: NodeKey;
  position: InsertionMarker;
};

export type DragInsertTargetValidator = (
  coordinates: DragInsertCoordinates
) => boolean;

function $insertWrappedBefore(
  key: NodeKey,
  node: LexicalNode,
  wrapper: () => ElementNode = $createParagraphNode
) {
  const targetNode = $getNodeByKey(key);
  if (!targetNode) return;
  const wrappedElem = wrapper().append(node);
  targetNode.insertBefore(wrappedElem);
}

function $insertWrappedAfter(
  key: NodeKey,
  node: LexicalNode,
  wrapper: () => ElementNode = $createParagraphNode
) {
  const targetNode = $getNodeByKey(key);
  if (!targetNode) return;
  const wrappedElem = wrapper().append(node);
  targetNode.insertAfter(wrappedElem);
}

export function getValidDragInsertPosition(
  editor: LexicalEditor,
  coordinates: DragInsertCoordinates,
  isValidDropTarget?: DragInsertTargetValidator
): ValidDragInsertPosition | undefined {
  if (isValidDropTarget && !isValidDropTarget(coordinates)) return undefined;

  const { key, position } = calculateInsertPoint(
    editor,
    coordinates,
    DRAG_INSERT_COLLISION_PADDING
  );
  if (!key || !position) return undefined;

  return { key, position };
}

export function clearDragInsertPreview(
  setState: SetStoreFunction<DragInsertState>
) {
  setState({ visible: false });
}

export function updateDragInsertPreviewFromCoordinates(args: {
  editor: LexicalEditor;
  coordinates: DragInsertCoordinates;
  setState: SetStoreFunction<DragInsertState>;
  isValidDropTarget?: DragInsertTargetValidator;
}): ValidDragInsertPosition | undefined {
  const dragInsertPosition = getValidDragInsertPosition(
    args.editor,
    args.coordinates,
    args.isValidDropTarget
  );
  if (!dragInsertPosition) {
    clearDragInsertPreview(args.setState);
    return undefined;
  }

  args.setState({
    nodeKey: dragInsertPosition.key,
    position: dragInsertPosition.position,
    visible: true,
  });
  return dragInsertPosition;
}

export function insertDocumentMentionAtDragInsertPosition(
  editor: LexicalEditor,
  dragInsertPosition: ValidDragInsertPosition,
  mentionInfo: DocumentMentionInfo
) {
  editor.update(() => {
    const mention = $createDocumentMentionNode({
      ...mentionInfo,
      createdAt: mentionInfo.createdAt ?? Date.now(),
    });

    if (dragInsertPosition.position === 'before') {
      $insertWrappedBefore(dragInsertPosition.key, mention);
    } else {
      $insertWrappedAfter(dragInsertPosition.key, mention);
    }
    mention.selectEnd();
  });
}

export function insertDocumentMentionAtDragCoordinates(args: {
  editor: LexicalEditor;
  coordinates?: DragInsertCoordinates;
  mentionInfo: DocumentMentionInfo;
  isValidDropTarget?: DragInsertTargetValidator;
}) {
  if (!args.coordinates) return false;
  const dragInsertPosition = getValidDragInsertPosition(
    args.editor,
    args.coordinates,
    args.isValidDropTarget
  );
  if (!dragInsertPosition) return false;

  insertDocumentMentionAtDragInsertPosition(
    args.editor,
    dragInsertPosition,
    args.mentionInfo
  );
  return true;
}
