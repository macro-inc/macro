import NewSplitIcon from '@icon/wide-newSplit.svg';
import ExpandIcon from '@phosphor/arrows-out.svg';
import { Button } from '@ui';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';

/** Popover header action that targets a new split, or the current split with Shift. */
export function ExperimentalPopoverSplitAction(props: {
  onOpen: (openInCurrentSplit: boolean) => void;
}) {
  const [shiftHeld, setShiftHeld] = createSignal(false);

  onMount(() => {
    const updateShiftState = (event: KeyboardEvent) => {
      if (event.key === 'Shift') setShiftHeld(event.type === 'keydown');
    };
    const clearShiftState = () => setShiftHeld(false);
    window.addEventListener('keydown', updateShiftState);
    window.addEventListener('keyup', updateShiftState);
    window.addEventListener('blur', clearShiftState);
    onCleanup(() => {
      window.removeEventListener('keydown', updateShiftState);
      window.removeEventListener('keyup', updateShiftState);
      window.removeEventListener('blur', clearShiftState);
    });
  });

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      class="size-8 rounded-lg text-ink-muted [&_svg]:size-4!"
      label={shiftHeld() ? 'Open in current split' : 'Open in split'}
      tooltipPlacement="left"
      aria-label={shiftHeld() ? 'Open in current split' : 'Open in split'}
      onClick={(event: MouseEvent) =>
        props.onOpen(event.shiftKey || shiftHeld())
      }
    >
      <Show when={shiftHeld()} fallback={<NewSplitIcon />}>
        <ExpandIcon />
      </Show>
    </Button>
  );
}
