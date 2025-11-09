import { vec2 } from '@block-canvas/util/vector2';
import { createBlockStore } from '@core/block';
import { OldMenu } from '@core/component/OldMenu';
import clickOutside from '@core/directive/clickOutside';
import {
  autoUpdate,
  computePosition,
  hide,
  offset,
  shift,
} from '@floating-ui/dom';
import {
  type Accessor,
  children,
  createEffect,
  createMemo,
  onCleanup,
  type ParentProps,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';

interface BaseMenuProps {
  open: boolean;
  x: number;
  y: number;
  ref?: HTMLDivElement | ((ref: HTMLDivElement) => void);
}
export function BaseMenu(props: ParentProps<BaseMenuProps>) {
  const safeChildren = children(() => props.open && props.children);
  return (
    <Show when={props.open}>
      <Portal>
        <div
          style={{ left: `${props.x}px`, top: `${props.y}px` }}
          class="absolute z-item-options-menu"
          ref={props.ref}
        >
          <OldMenu width="md">{safeChildren()}</OldMenu>
        </div>
      </Portal>
    </Show>
  );
}

export const contextMenuStore = createBlockStore<{
  open: boolean;
  x: number;
  y: number;
  ref?: HTMLDivElement;
  mousePos?: { x: number; y: number };
}>({
  open: false,
  x: 0,
  y: 0,
});

export function createContextMenu(
  anchorElement: Accessor<HTMLElement | undefined>
) {
  const [contextMenu, setContextMenu] = contextMenuStore;

  const contextMenuPos = () => {
    return vec2(contextMenu.x, contextMenu.y);
  };

  const openContextMenu = (mousePos?: { x: number; y: number }) =>
    setContextMenu({ open: true, mousePos });

  const closeContextMenu = () => setContextMenu({ open: false });

  const ContextMenu = (props: ParentProps) => {
    createEffect(() => {
      if (contextMenu.open && contextMenu.ref)
        clickOutside(contextMenu.ref, () => closeContextMenu, true);
    });

    onCleanup(() => setContextMenu({ ref: undefined }));
    return (
      <BaseMenu
        open={contextMenu.open}
        x={contextMenu.x}
        y={contextMenu.y}
        children={props.children}
        ref={(ref) => {
          setContextMenu({ ref });
        }}
      />
    );
  };

  const offsetByMousePos = createMemo(() => {
    const referenceEl = anchorElement();
    if (!referenceEl) return;

    if (!contextMenu.mousePos) return;

    const { x, y } = contextMenu.mousePos;
    const rects = referenceEl.getBoundingClientRect();
    return offset({
      mainAxis: y - rects.y - rects.height,
      crossAxis: x - rects.x,
    });
  });

  const updatePosition = () => {
    const referenceEl = anchorElement();
    if (!referenceEl || !contextMenu.ref) return;

    const middleware = [shift({ padding: 16, crossAxis: true }), hide()];
    const offsetMiddleware = offsetByMousePos();
    if (offsetMiddleware) {
      middleware.unshift(offsetMiddleware);
    }

    computePosition(referenceEl, contextMenu.ref, {
      placement: 'bottom-start',
      strategy: 'absolute',
      middleware,
    }).then(({ x, y, middlewareData: { hide } }) => {
      if (hide?.referenceHidden) return closeContextMenu();

      setContextMenu({ x, y });
    });
  };

  createEffect(() => {
    const referenceEl = anchorElement();
    if (!contextMenu.open || !referenceEl || !contextMenu.ref) return;

    const cleanup = autoUpdate(referenceEl, contextMenu.ref, updatePosition);
    onCleanup(() => cleanup());
  });

  createEffect(() => {
    if (contextMenu.open) anchorElement()?.focus();
    else anchorElement()?.blur();
  });

  return {
    openContextMenu,
    closeContextMenu,
    ContextMenu,
    isOpen: () => contextMenu.open,
    contextMenuPos,
    menuRef: () => contextMenu.ref,
  };
}
