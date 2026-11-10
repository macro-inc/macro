import { debounce } from '@core/util/debounce';
import { onCleanup } from 'solid-js';

/** Coordinate hover, focus and keyboard traversal without consuming mute clicks. */
export function createRecordingVolume(options: {
  onOpenChange: (open: boolean) => void;
  onTabForward: () => void;
  toggleMute: () => void;
}) {
  let trigger: HTMLButtonElement | undefined;
  let content: HTMLDivElement | undefined;
  let thumb: HTMLSpanElement | undefined;
  let restoringFocus = false;
  const close = debounce(() => {
    const focusOnTrigger = trigger === document.activeElement;
    const focusInContent = content?.contains(document.activeElement);
    if (!focusOnTrigger && !focusInContent) options.onOpenChange(false);
  }, 150);
  const open = () => {
    close.clear();
    options.onOpenChange(true);
  };
  onCleanup(() => close.clear());
  return {
    open,
    close,
    setTrigger: (element: HTMLButtonElement) => {
      trigger = element;
    },
    setContent: (element: HTMLDivElement) => {
      content = element;
    },
    setThumb: (element: HTMLSpanElement) => {
      thumb = element;
    },
    // Escape restores focus to the trigger without reopening the volume popover.
    onFocus: () => {
      if (!restoringFocus) open();
    },
    onClick: () => {
      options.toggleMute();
      open();
    },
    // Arrow keys and forward Tab move focus into the slider, not through the popover.
    onTriggerKeyDown: (event: KeyboardEvent) => {
      if (
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown' ||
        (event.key === 'Tab' && !event.shiftKey)
      ) {
        event.preventDefault();
        open();
        queueMicrotask(() => thumb?.focus());
      }
    },
    onContentFocus: () => close.clear(),
    onInteractOutside: (event: {
      target: EventTarget | null;
      preventDefault: () => void;
    }) => {
      if (event.target instanceof Node && trigger?.contains(event.target))
        event.preventDefault();
    },
    onEscape: () => {
      restoringFocus = true;
      trigger?.focus({ preventScroll: true });
      restoringFocus = false;
    },
    onSliderKeyDown: (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      event.preventDefault();
      if (event.shiftKey) {
        trigger?.focus({ preventScroll: true });
        return;
      }
      options.onTabForward();
      options.onOpenChange(false);
    },
  };
}
