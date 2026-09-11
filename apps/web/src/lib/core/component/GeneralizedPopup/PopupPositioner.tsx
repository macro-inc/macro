import { isInBlock } from '@core/block';
import { blockElementSignal } from '@core/signal/blockElement';
import {
  autoUpdate,
  type Boundary,
  computePosition,
  flip,
  offset as offsetMiddleware,
  type Placement,
  shift,
} from '@floating-ui/dom';
import { mergeRefs } from '@solid-primitives/refs';
import { Layer } from '@ui';
import {
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  type Ref,
} from 'solid-js';

type PopupPositionerProps = {
  /** Reference element the popup is positioned against. */
  anchor: HTMLElement;
  children: JSX.Element;
  /** Preferred placement relative to the anchor. Defaults to `bottom`. */
  placement?: Placement;
  /** Gap between the anchor and the popup, in pixels. Defaults to 12. */
  offset?: number;
  /** Padding kept between the popup and the boundary when shifting. Defaults to 8. */
  shiftPadding?: number;
  /**
   * Clip the popup to the surrounding block element rather than the default
   * clipping ancestors. Only takes effect inside a block context.
   */
  useBlockBoundary?: boolean;
  /** Stacking depth for the floating layer. Defaults to 2. */
  layerDepth?: 0 | 1 | 2 | 3 | 4;
  /** Forwarded to the positioned container element. */
  ref?: Ref<HTMLDivElement>;
};

/**
 * Headless positioning wrapper. Anchors its children to a reference element
 * using floating-ui and keeps them positioned on scroll/resize. It renders no
 * visual chrome of its own — wrap the children in `Toolbar` (or any other
 * component) for styling.
 */
export function PopupPositioner(props: PopupPositionerProps) {
  const [popupRef, setPopupRef] = createSignal<HTMLDivElement>();
  const [position, setPosition] = createSignal({ x: 0, y: 0 });

  let boundary: Boundary = 'clippingAncestors';
  if (props.useBlockBoundary && isInBlock()) {
    const blockEl = blockElementSignal.get;
    boundary = blockEl() ?? 'clippingAncestors';
  }

  const updatePosition = async () => {
    const ref = popupRef();
    if (!ref) return;
    const { x, y } = await computePosition(props.anchor, ref, {
      placement: props.placement ?? 'bottom',
      middleware: [
        offsetMiddleware(props.offset ?? 12),
        flip({
          fallbackStrategy: 'initialPlacement',
          boundary,
        }),
        shift({ padding: props.shiftPadding ?? 8, boundary }),
      ],
    });

    setPosition({ x, y });
  };

  createEffect(() => {
    const ref = popupRef();
    if (!ref) return;

    const cleanup = autoUpdate(props.anchor, ref, updatePosition);
    onCleanup(() => cleanup());
  });

  return (
    <Layer depth={props.layerDepth ?? 2}>
      <div
        ref={mergeRefs(setPopupRef, props.ref)}
        class="absolute"
        style={{
          left: `${position().x}px`,
          top: `${position().y}px`,
          'transform-origin': 'top',
        }}
      >
        {props.children}
      </div>
    </Layer>
  );
}
