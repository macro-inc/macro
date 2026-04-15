import { $isListItemNode, $isListNode } from '@lexical/list';
import { $getNearestNodeFromDOMNode } from 'lexical';
import { Show, useContext } from 'solid-js';
import type { SetStoreFunction, Store } from 'solid-js/store';
import { Portal } from 'solid-js/web';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import {
  DRAG_DATA_FORMAT,
  type DraggableBlockState,
} from '../../plugins/draggable-block/draggableBlockPlugin';
import DotsSixVerticalIcon from '@icon/bold/dots-six-vertical-bold.svg';

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

    // Vertically center on the first line (approximated via line-height).
    const lineHeight = parseInt(window.getComputedStyle(elem).lineHeight, 10);
    const effectiveHeight = isNaN(lineHeight)
      ? Math.min(rect.height, 28)
      : Math.min(lineHeight, rect.height);

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
    ed.read(() => {
      const node = $getNearestNodeFromDOMNode(elem);
      if (!node) return;

      // First item of a list → drag the entire list (same for sublists).
      if ($isListItemNode(node)) {
        const parent = node.getParent();
        if (parent && $isListNode(parent) && parent.getFirstChild() === node) {
          nodeKey = parent.getKey();
          const listElem = ed.getElementByKey(nodeKey);
          if (listElem) dragImageElem = listElem;
          return;
        }
      }

      nodeKey = node.getKey();
    });
    if (!nodeKey) return;

    // Use the block element itself as the drag image.
    const { transform } = dragImageElem.style;
    dragImageElem.style.transform = 'translateZ(0)';
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setDragImage(dragImageElem, 0, 0);
    setTimeout(() => {
      dragImageElem.style.transform = transform;
    });

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
      <Portal>
        {/* Drag handle */}
        <div
          class="draggable-block-menu fixed z-10 flex items-center justify-center cursor-grab rounded transition-opacity duration-100"
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
          <DotsSixVerticalIcon class="size-5 text-ink-extra-muted opacity-50 pointer-events-none" />
        </div>

        {/* Drop target line */}
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
      </Portal>
    </Show>
  );
}
