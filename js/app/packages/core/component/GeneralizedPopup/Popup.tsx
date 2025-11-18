import { type BlockName, isInBlock } from '@core/block';
import { blockElementSignal } from '@core/signal/blockElement';
import {
  autoUpdate,
  type Boundary,
  computePosition,
  flip,
  offset,
  shift,
} from '@floating-ui/dom';
import { mergeRefs } from '@solid-primitives/refs';
import {
  type Component,
  createEffect,
  createSignal,
  onCleanup,
  type Ref,
} from 'solid-js';

type GeneralizedPopupProps = {
  PopupComponents: Component;
  anchor: {
    ref: HTMLElement;
    blockId: string;
    blockType: BlockName;
  };
  useBlockBoundary?: boolean;
  ref?: Ref<HTMLDivElement>;
};

export function GeneralizedPopup(props: GeneralizedPopupProps) {
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
    const { x, y } = await computePosition(props.anchor.ref, ref, {
      placement: 'bottom',
      middleware: [
        offset(12),
        flip({
          fallbackStrategy: 'initialPlacement',
          boundary,
        }),
        shift({ padding: 8, boundary }),
      ],
    });

    setPosition({ x, y });
  };

  createEffect(() => {
    const ref = popupRef();
    if (!ref) return;

    const cleanup = autoUpdate(props.anchor.ref, ref, updatePosition);
    onCleanup(() => cleanup());
  });

  return (
    <div
      ref={mergeRefs(setPopupRef, props.ref)}
      id="generalized-popup"
      class="absolute bg-menu shadow-xl ring-1 ring-edge z-highlight-menu rounded-xs inline-flex items-start flex-col p-1"
      style={{
        left: `${position().x}px`,
        top: `${position().y}px`,
        'transform-origin': 'top',
      }}
    >
      <props.PopupComponents />
    </div>
  );
}
