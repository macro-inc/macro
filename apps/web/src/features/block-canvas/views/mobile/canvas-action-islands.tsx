import { MobileDockButton } from '@components/app/mobile/MobileDockButton';
import { MobileDockIsland } from '@components/app/mobile/MobileDockIsland';
import Undo from '@icon/system/regular/arrow-u-up-left.svg';
import Redo from '@icon/system/regular/arrow-u-up-right.svg';
import Copy from '@icon/system/regular/copy.svg';
import DotsThree from '@icon/system/regular/dots-three.svg';
import Palette from '@icon/system/regular/palette.svg';
import Trash from '@icon/system/regular/trash.svg';
import { cn } from '@ui';
import type { Component, JSX } from 'solid-js';

/** An action in the canvas chrome, sized like the tools beside it. */
function ActionButton(props: {
  icon: Component<{ class?: string }>;
  label: string;
  onClick: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
  disabled?: boolean;
  pressed?: boolean;
  class?: string;
}) {
  return (
    <MobileDockButton
      icon={props.icon}
      ariaLabel={props.label}
      disabled={props.disabled}
      // A disabled action dims like an unselected dock button.
      active={props.disabled ? false : undefined}
      aria-pressed={props.pressed}
      class={cn(
        'h-[44px] w-[46px] min-w-[40px] shrink aria-pressed:bg-ink/8',
        props.class
      )}
      onClick={props.onClick}
    />
  );
}

/** The zoom level; a tap opens zoom, fit, grid and snapping. */
export function MobileCanvasViewButton(props: {
  scale: number;
  onClick: () => void;
}) {
  return (
    <MobileDockIsland class="shrink-0">
      <button
        type="button"
        aria-label="Zoom options"
        aria-haspopup="dialog"
        class="flex h-[44px] min-w-[60px] items-center justify-center rounded-full px-[12px] text-[15px] font-medium tabular-nums"
        onClick={props.onClick}
      >
        <output aria-label="Zoom level">
          {Math.round(props.scale * 100)}%
        </output>
      </button>
    </MobileDockIsland>
  );
}

export function MobileCanvasHistoryIsland(props: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <MobileDockIsland class="min-w-0 shrink">
      <div role="group" aria-label="Canvas history" class="flex min-w-0">
        <ActionButton
          icon={Undo}
          label="Undo"
          disabled={!props.canUndo}
          onClick={props.onUndo}
        />
        <ActionButton
          icon={Redo}
          label="Redo"
          disabled={!props.canRedo}
          onClick={props.onRedo}
        />
      </div>
    </MobileDockIsland>
  );
}

/** What to do with the selection: restyle it, copy it in place, remove it, or more. */
export function MobileCanvasSelectionIsland(props: {
  styleOpen: boolean;
  onStyle: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMore: () => void;
}) {
  return (
    <MobileDockIsland class="min-w-0 shrink">
      <div role="group" aria-label="Selection actions" class="flex min-w-0">
        <ActionButton
          icon={Palette}
          label="Style"
          pressed={props.styleOpen}
          onClick={props.onStyle}
        />
        <ActionButton
          icon={Copy}
          label="Duplicate"
          onClick={props.onDuplicate}
        />
        <ActionButton
          icon={Trash}
          label="Delete"
          class="text-failure-ink"
          onClick={props.onDelete}
        />
        <ActionButton
          icon={DotsThree}
          label="More actions"
          onClick={props.onMore}
        />
      </div>
    </MobileDockIsland>
  );
}
