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
    if (
      trigger !== document.activeElement &&
      !content?.contains(document.activeElement)
    )
      options.onOpenChange(false);
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
    onFocus: () => {
      if (!restoringFocus) open();
    },
    onClick: () => {
      options.toggleMute();
      open();
    },
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
      if (event.shiftKey) trigger?.focus({ preventScroll: true });
      else {
        options.onTabForward();
        options.onOpenChange(false);
      }
    },
  };
}
