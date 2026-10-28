import { isTouchDevice } from '@core/mobile/isTouchDevice';
import SquareSplitHorizontalIcon from '@icon/system/regular/square-split-horizontal.svg';
import { Button, ButtonGroup, cn } from '@ui';

/** Toggles the changes pane; totals live beside the pane's branch range. */
export function ChangesToggleButton(props: {
  open: boolean;
  grouped?: boolean;
  onToggle: () => void;
}) {
  const Control = props.grouped ? ButtonGroup.Button : Button;
  return (
    <Control
      aria-label="Changes"
      variant="ghost"
      size={isTouchDevice() || props.grouped ? 'sm' : 'md'}
      aria-pressed={props.open}
      tooltip={props.open ? 'Hide the changes pane' : 'Show the changes pane'}
      // The label collapses as the header narrows; the pressed fill marks open.
      class={cn(
        'touch:h-7 gap-1.5 touch:@max-[28rem]/split-header:w-7 @max-[28rem]/split-header:gap-0 @max-[28rem]/split-header:px-0',
        props.grouped
          ? 'not-touch:@max-[28rem]/split-header:w-7'
          : 'not-touch:@max-[28rem]/split-header:w-8'
      )}
      onClick={() => props.onToggle()}
    >
      <SquareSplitHorizontalIcon class="size-3.5" />
      <span class="@max-[28rem]/split-header:hidden">Changes</span>
    </Control>
  );
}
