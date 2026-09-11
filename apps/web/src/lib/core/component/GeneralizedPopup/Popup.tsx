import type { BlockName } from '@core/block';
import type { ParentProps, Ref } from 'solid-js';
import { PopupPositioner } from './PopupPositioner';

type GeneralizedPopupProps = ParentProps<{
  anchor: {
    ref: HTMLElement;
    blockId: string;
    blockType: BlockName;
  };
  useBlockBoundary?: boolean;
  ref?: Ref<HTMLDivElement>;
}>;

/**
 * Anchored popup with the legacy surface chrome. Positioning lives in
 * `PopupPositioner`; new surfaces should prefer the opinionated `Toolbar`
 * component instead of this container.
 */
export function GeneralizedPopup(props: GeneralizedPopupProps) {
  return (
    <PopupPositioner
      anchor={props.anchor.ref}
      useBlockBoundary={props.useBlockBoundary}
    >
      <div
        ref={props.ref}
        id="generalized-popup"
        class="border border-edge bg-surface shadow-xl rounded-lg z-highlight-menu inline-flex items-start flex-col p-1"
      >
        {props.children}
      </div>
    </PopupPositioner>
  );
}
