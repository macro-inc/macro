import type { BlockName } from '@core/block';
import type { Component, Ref } from 'solid-js';
import { PopupPositioner } from './PopupPositioner';
import { PopupSurface } from './PopupSurface';

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

/**
 * Anchored popup with the standard surface chrome. A thin composition of
 * `PopupPositioner` (placement) and `PopupSurface` (styling); reach for those
 * directly when you need to position or style content independently.
 */
export function GeneralizedPopup(props: GeneralizedPopupProps) {
  return (
    <PopupPositioner
      anchor={props.anchor.ref}
      useBlockBoundary={props.useBlockBoundary}
    >
      <PopupSurface ref={props.ref}>
        <props.PopupComponents />
      </PopupSurface>
    </PopupPositioner>
  );
}
