import { ScopedPortal } from '@core/component/ScopedPortal';
import { getScrollParentElement } from '@core/util/scrollParent';
import Dots from '@icon/system/regular/dots-six-vertical.svg';
import { Show } from 'solid-js';
import type { Store } from 'solid-js/store';
import type { DraggableBlockHost } from '../../editing/overlay-hosts/draggable-block';
import type { DraggableBlockState } from '../../plugins/draggable-block/draggableBlockPlugin';
import { FOLDABLE_HEADING_ATTRIBUTE } from '../../plugins/heading-folds';

const HANDLE_SIZE = 20;
const HANDLE_GAP = 4;

export function HostedDraggableBlockMenu(props: {
  state: Store<DraggableBlockState>;
  host: DraggableBlockHost;
  active: boolean;
}) {
  const handlePosition = () => {
    const elem = props.state.hoveredElement;
    if (!elem) return null;

    const rect = elem.getBoundingClientRect();
    const root = props.host.root();
    if (!root) return null;
    const rootRect = root.getBoundingClientRect();

    const effectiveHeight = Math.min(rect.height, 24);
    // A heading's fold control takes the gutter column next to the text, and
    // the handle steps one column out. A gutter too narrow for both (a narrow
    // pane) keeps the fold control, and the heading shows no drag handle.
    const foldable = elem.hasAttribute(FOLDABLE_HEADING_ATTRIBUTE);
    const columns = foldable ? 2 : 1;
    const gutterLeft =
      getScrollParentElement(root)?.getBoundingClientRect().left ?? 0;
    if (foldable && rootRect.left - gutterLeft < 2 * (HANDLE_SIZE + HANDLE_GAP))
      return null;

    return {
      top: rect.top + (effectiveHeight - HANDLE_SIZE) / 2,
      left: rootRect.left - columns * (HANDLE_SIZE + HANDLE_GAP),
    };
  };

  const targetLinePosition = () => {
    const elem = props.state.targetElement;
    const position = props.state.targetPosition;
    if (!elem || !position) return null;

    const rect = elem.getBoundingClientRect();
    const rootRect = props.host.root()?.getBoundingClientRect();
    if (!rootRect) return null;

    const padding = 4;
    return {
      top: position === 'before' ? rect.top - padding : rect.bottom + padding,
      left: rootRect.left,
      width: rootRect.width,
    };
  };

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
          onDragStart={(event) =>
            props.host.start(event, props.state.hoveredElement)
          }
          onDragEnd={() => props.host.end()}
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
