import { $isListItemNode, $isListNode, type ListItemNode } from '@lexical/list';
import { $getNearestNodeFromDOMNode, type LexicalEditor } from 'lexical';
import type { Accessor } from 'solid-js';
import {
  $collectNestedGroup,
  DRAG_DATA_FORMAT,
  type DraggableBlockState,
} from '../../plugins/draggable-block/draggableBlockPlugin';
import type { DraggableBlockHost } from './draggable-block';

/** Keep Source drag callbacks and preview ownership on the actual Source editor. */
export function createLexicalDraggableBlockHost(
  editor: Accessor<LexicalEditor | undefined>,
  setState: (patch: Partial<DraggableBlockState>) => void
): DraggableBlockHost {
  function onDragStart(event: DragEvent, element: HTMLElement | null) {
    const elem = element;
    const ed = editor();
    if (!elem || !event.dataTransfer || !ed) return;

    let nodeKey = '';
    let dragImageElem: HTMLElement = elem;
    // Elements to temporarily hide so the parent list can be used as drag
    // image showing only the dragged group.
    let hideElems: HTMLElement[] = [];
    let listElemForImage: HTMLElement | null = null;

    ed.read(() => {
      const node = $getNearestNodeFromDOMNode(elem);
      if (!node) return;

      if ($isListItemNode(node)) {
        const parent = node.getParent();

        // First item of a list → drag the entire list.
        if (parent && $isListNode(parent) && parent.getFirstChild() === node) {
          nodeKey = parent.getKey();
          const le = ed.getElementByKey(nodeKey);
          if (le) dragImageElem = le;
          return;
        }

        // Non-first item with nested children: figure out which sibling
        // <li>s to temporarily hide so the parent list preview only shows
        // the dragged group.
        if (parent && $isListNode(parent)) {
          const group = $collectNestedGroup(node as ListItemNode);
          if (group.length > 1) {
            const groupKeys = new Set(group.map((n) => n.getKey()));
            for (const child of parent.getChildren()) {
              if (!groupKeys.has(child.getKey())) {
                const el = ed.getElementByKey(child.getKey());
                if (el) hideElems.push(el);
              }
            }
            listElemForImage = ed.getElementByKey(parent.getKey());
          }
        }
      }

      nodeKey = node.getKey();
    });

    if (!nodeKey) return;

    event.dataTransfer.effectAllowed = 'move';

    if (hideElems.length > 0 && listElemForImage) {
      const listImg: HTMLElement = listElemForImage;
      // Temporarily hide non-group siblings so the parent list element
      // only shows the items being dragged.  The browser captures the
      // drag image snapshot synchronously, so restoring in setTimeout is
      // safe.
      for (const el of hideElems) el.style.display = 'none';
      listImg.style.transform = 'translateZ(0)';
      event.dataTransfer.setDragImage(listImg, 0, 0);
      setTimeout(() => {
        for (const el of hideElems) el.style.display = '';
        listImg.style.transform = '';
      });
    } else {
      const { transform } = dragImageElem.style;
      dragImageElem.style.transform = 'translateZ(0)';
      event.dataTransfer.setDragImage(dragImageElem, 0, 0);
      setTimeout(() => {
        dragImageElem.style.transform = transform;
      });
    }

    event.dataTransfer.setData(DRAG_DATA_FORMAT, nodeKey);
    setState({ isDragging: true });
  }

  function onDragEnd() {
    setState({
      isDragging: false,
      targetElement: null,
      targetPosition: null,
      hoveredElement: null,
    });
  }

  return {
    root: () => editor()?.getRootElement() ?? null,
    start: onDragStart,
    end: onDragEnd,
  };
}
