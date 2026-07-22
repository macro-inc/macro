import { DRAG_DROP_PASTE } from '@lexical/rich-text';
import { mergeRegister } from '@lexical/utils';
import {
  $getNodeByKey,
  $getRoot,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  DRAGOVER_COMMAND,
  DROP_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
  type NodeKey,
} from 'lexical';
import { createStore, type SetStoreFunction } from 'solid-js/store';

export type DragInsertState = {
  nodeKey: NodeKey | null;
  position: InsertionMarker | null;
  visible: boolean;
};

export const createDragInsertStore = () => {
  return createStore<DragInsertState>({
    nodeKey: null,
    position: null,
    visible: false,
  });
};

/**
 * Props for the drag insert plugin.
 * @param onDrop - Called when a drop occurs. The node key and the position
 *     ('before' or 'after') are provided.
 * @param onDragOver - Called when a drag over occurs. The node key and the
 *     position ('before' or 'after') are provided.
 * @param onDragLeave - Called when a drag leave occurs.
 * @param onDragEnd - Called when a drag end occurs.
 * @param collisionPadding - The amount of padding to add to the elements when
 *     calculating the insertion point. Defaults to 8, matching the padding
 *     used by the drop-position helpers in utils/fileUploadUtils.ts and
 *     utils/dragInsertUtils.ts so the preview agrees with the insertion.
 * @param setState - A DragInsertState store to recive the state of the
 *     dragging. Can be passed to the DragInsertIndicator component.
 * @param dragListenerRef - A ref to a div that will listen for drag events.
 *     If not provided, the plugin will listen to the root element.
 */
type DragInsertPluginProps = {
  onDrop?: (key: NodeKey, position: InsertionMarker, event: DragEvent) => void;
  onDragOver?: (
    key: NodeKey,
    position: InsertionMarker,
    event: DragEvent
  ) => void;
  onDragLeave?: (event: DragEvent) => void;
  onDragEnd?: (event: DragEvent) => void;
  collisionPadding?: number;
  setState?: SetStoreFunction<DragInsertState>;
  dragListenerRef?: HTMLDivElement;
};

export type InsertionMarker = 'before' | 'after';

const DEFAULT_COLLISION_PADDING = 8;

export const SET_SELECTION_AT_INSERTION: LexicalCommand<
  [NodeKey, InsertionMarker]
> = createCommand('SET_SELECTION_AT_INSERTION');

function containsX(rect: DOMRect, x: number, padding = 0) {
  return x >= rect.left - padding && x <= rect.right + padding;
}

function containsY(rect: DOMRect, y: number, padding = 0) {
  return y >= rect.top - padding && y <= rect.bottom + padding;
}

function elementKeyToDomRect(editor: LexicalEditor, key: NodeKey) {
  const element = editor.getElementByKey(key);
  if (element) {
    return element.getBoundingClientRect();
  }
}

/**
 * Get an insertion point from a drag event.DOMRect
 */
export function calculateInsertPoint(
  editor: LexicalEditor,
  event: DragEvent | { clientX: number; clientY: number },
  collisionPadding = 0
): {
  key: NodeKey | null;
  position: InsertionMarker | null;
  domRect: DOMRect | null;
} {
  return editor.read(() => {
    const editorRect = editor.getRootElement()?.getBoundingClientRect();
    if (
      !editorRect ||
      !containsX(editorRect, event.clientX, collisionPadding)
    ) {
      return { key: null, position: null, domRect: null };
    }

    const root = $getRoot();
    const children = root.getChildren();
    if (children.length === 0) {
      return { key: null, position: null, domRect: null };
    }

    const firstRect = elementKeyToDomRect(editor, children[0].getKey());
    if (firstRect && event.clientY < firstRect.top) {
      return {
        key: children[0].getKey(),
        position: 'before',
        domRect: firstRect,
      };
    }

    const lastRect = elementKeyToDomRect(
      editor,
      children[children.length - 1].getKey()
    );
    if (lastRect && event.clientY > lastRect.bottom) {
      return {
        key: children[children.length - 1].getKey(),
        position: 'after',
        domRect: lastRect,
      };
    }

    for (const childNode of children) {
      const elem = editor.getElementByKey(childNode.getKey());

      if (elem === null) {
        console.error('Drag insert: element not found for a top level node');
        return { key: null, position: null, domRect: null };
      }

      const rect = elem.getBoundingClientRect();

      if (containsY(rect, event.clientY, collisionPadding)) {
        if (event.clientY < rect.top + rect.height * 0.5) {
          const priorSibling = childNode.getPreviousSibling();
          if (priorSibling) {
            const priorSiblingRect = editor
              .getElementByKey(priorSibling.getKey())
              ?.getBoundingClientRect();
            if (priorSiblingRect) {
              return {
                key: priorSibling.getKey(),
                position: 'after',
                domRect: priorSiblingRect,
              };
            }
          }
          return { key: childNode.getKey(), position: 'before', domRect: rect };
        }
        return { key: childNode.getKey(), position: 'after', domRect: rect };
      }
    }
    return { key: null, position: null, domRect: null };
  });
}

function registerDragInsert(
  editor: LexicalEditor,
  props: DragInsertPluginProps
) {
  const collisionPadding = props.collisionPadding ?? DEFAULT_COLLISION_PADDING;

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    const { key, position } = calculateInsertPoint(
      editor,
      event,
      collisionPadding
    );

    if (!key || !position) {
      // No insert point under the cursor (e.g. a gap between blocks): hide the
      // preview instead of leaving it frozen at the last valid position, which
      // no longer matches where a drop would insert.
      if (props.setState) {
        props.setState({ visible: false });
      }
      return;
    }

    if (props.setState) {
      props.setState({ nodeKey: key, position, visible: true });
    }

    if (props.onDragOver) {
      props.onDragOver(key, position, event);
    }
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    // Always hide the preview, even when the drop point resolves to no valid
    // insert position. Drags that originate outside this editor (OS files,
    // images dragged from other components) never fire dragend/dragleave here
    // after the drop, so this is the last chance to clear the indicator.
    if (props.setState) {
      props.setState({ visible: false });
    }

    const { key, position } = calculateInsertPoint(
      editor,
      event,
      collisionPadding
    );
    if (!key || !position) {
      return;
    }

    if (props.onDrop) {
      editor.dispatchCommand(SET_SELECTION_AT_INSERTION, [key, position]);
      props.onDrop(key, position, event);
    }
  };

  const handleDragLeave = (event: DragEvent) => {
    if (props.setState) {
      props.setState({ visible: false });
    }

    if (props.onDragLeave) {
      props.onDragLeave(event);
    }
  };

  const handleDragEnd = (event: DragEvent) => {
    if (props.setState) {
      props.setState({ visible: false });
    }

    if (props.onDragEnd) {
      props.onDragEnd(event);
    }
  };

  let cleanupOnCustomRef: (ref?: HTMLDivElement) => void = () => {};

  if (props.dragListenerRef) {
    props.dragListenerRef.addEventListener('dragover', handleDragOver);
    props.dragListenerRef.addEventListener('drop', handleDrop);
    props.dragListenerRef.addEventListener('dragleave', handleDragLeave);
    props.dragListenerRef.addEventListener('dragend', handleDragEnd);
    cleanupOnCustomRef = (ref?: HTMLDivElement) => {
      ref?.removeEventListener('dragover', handleDragOver);
      ref?.removeEventListener('drop', handleDrop);
      ref?.removeEventListener('dragleave', handleDragLeave);
      ref?.removeEventListener('dragend', handleDragEnd);
    };
  }

  return mergeRegister(
    editor.registerCommand(
      SET_SELECTION_AT_INSERTION,
      ([key, position]) => {
        if (!key) return false;
        const node = $getNodeByKey(key);
        if (!node) return false;
        editor.update(() => {
          if (position === 'before') {
            node.selectStart();
          } else if (position === 'after') {
            node.selectEnd();
          }
        });
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    // Override the default drag and drop behavior.
    editor.registerCommand(DRAG_DROP_PASTE, () => true, COMMAND_PRIORITY_HIGH),
    editor.registerCommand(DRAGOVER_COMMAND, () => true, COMMAND_PRIORITY_HIGH),
    editor.registerCommand(DROP_COMMAND, () => true, COMMAND_PRIORITY_HIGH),

    () => cleanupOnCustomRef(props.dragListenerRef),

    editor.registerRootListener((root, prevRoot) => {
      if (root && !props.dragListenerRef) {
        root.addEventListener('dragover', handleDragOver);
        root.addEventListener('drop', handleDrop);
        root.addEventListener('dragleave', handleDragLeave);
        root.addEventListener('dragend', handleDragEnd);
      }
      if (prevRoot) {
        prevRoot.removeEventListener('dragover', handleDragOver);
        prevRoot.removeEventListener('drop', handleDrop);
        prevRoot.removeEventListener('dragleave', handleDragLeave);
        prevRoot.removeEventListener('dragend', handleDragEnd);
      }
    })
  );
}

export const dragInsertPlugin = (props: DragInsertPluginProps) => {
  return (editor: LexicalEditor) => registerDragInsert(editor, props);
};
