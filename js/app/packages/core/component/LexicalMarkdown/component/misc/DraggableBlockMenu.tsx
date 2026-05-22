import { ScopedPortal } from '@core/component/ScopedPortal';
import { $isListItemNode, $isListNode, type ListItemNode } from '@lexical/list';
import Dots from '@phosphor/dots-six-vertical.svg';
import { $getNearestNodeFromDOMNode } from 'lexical';
import { Show, useContext } from 'solid-js';
import type { SetStoreFunction, Store } from 'solid-js/store';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import {
  $collectNestedGroup,
  DRAG_DATA_FORMAT,
  type DraggableBlockState,
} from '../../plugins/draggable-block/draggableBlockPlugin';

const HANDLE_SIZE = 20;
const HANDLE_GAP = 4;

export function DraggableBlockMenu(props: {
  state: Store<DraggableBlockState>;
  setState: SetStoreFunction<DraggableBlockState>;
  active: boolean;
}) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = () => lexicalWrapper?.editor;

  const handlePosition = () => {
    const elem = props.state.hoveredElement;
    if (!elem) return null;

    const rect = elem.getBoundingClientRect();
    const rootRect = editor()?.getRootElement()?.getBoundingClientRect();
    if (!rootRect) return null;

    const effectiveHeight = Math.min(rect.height, 24);

    return {
      top: rect.top + (effectiveHeight - HANDLE_SIZE) / 2,
      left: rootRect.left - HANDLE_SIZE - HANDLE_GAP,
    };
  };

  const targetLinePosition = () => {
    const elem = props.state.targetElement;
    const position = props.state.targetPosition;
    if (!elem || !position) return null;

    const rect = elem.getBoundingClientRect();
    const rootRect = editor()?.getRootElement()?.getBoundingClientRect();
    if (!rootRect) return null;

    const padding = 4;
    return {
      top: position === 'before' ? rect.top - padding : rect.bottom + padding,
      left: rootRect.left,
      width: rootRect.width,
    };
  };

  function onDragStart(event: DragEvent) {
    const elem = props.state.hoveredElement;
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
    props.setState({ isDragging: true });
  }

  function onDragEnd() {
    props.setState({
      isDragging: false,
      targetElement: null,
      targetPosition: null,
      hoveredElement: null,
    });
  }

  return (
    <Show when={props.active}>
      <ScopedPortal scope="block">
        <div
          class="draggable-block-menu fixed z-user-highlight flex items-center justify-center cursor-grab rounded transition-opacity duration-100"
          classList={{
            'opacity-0 pointer-events-none': !handlePosition(),
            'opacity-100': !!handlePosition(),
          }}
          style={{
            top: (handlePosition()?.top ?? -9999) + 'px',
            left: (handlePosition()?.left ?? -9999) + 'px',
            width: HANDLE_SIZE + 'px',
            height: HANDLE_SIZE + 'px',
          }}
          draggable={!!handlePosition()}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <Dots
            class="size-5 text-ink-extra-muted opacity-50 pointer-events-none bg-
          [yellow]"
          />
        </div>

        <Show when={props.state.isDragging && targetLinePosition()}>
          {(pos) => (
            <div
              class="fixed bg-accent/60 pointer-events-none rounded-full ring-6 ring-accent/10"
              style={{
                top: pos().top - 1 + 'px',
                left: pos().left + 'px',
                width: pos().width + 'px',
                height: '2px',
              }}
            />
          )}
        </Show>
      </ScopedPortal>
    </Show>
  );
}
