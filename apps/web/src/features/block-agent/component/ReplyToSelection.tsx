/**
 * ChatGPT / Claude-style quote-reply: selecting transcript text shows a
 * "Reply to this" chip above the selection; choosing it hands the selected
 * text to `onReply` (the composer inserts it as a referenced paste chip).
 */

import { ScopedPortal } from '@core/component/ScopedPortal';
import { isMobile } from '@core/mobile/isMobile';
import { debouncedDependent } from '@core/util/debounce';
import Quote from '@phosphor/quotes.svg';
import { createSignal, onCleanup, Show } from 'solid-js';
import { readReplyableSelection } from '../state/reply-selection';

/** Gap between the top of the selection and the chip. */
const SPACING_PX = 8;

export function ReplyToSelection(props: {
  /** Selections outside this element (e.g. in the composer) are ignored. */
  container: HTMLElement | undefined;
  onReply: (text: string) => void;
}) {
  // On mobile the native selection toolbar takes this chip's place.
  if (isMobile()) return '';

  // Viewport coordinates of the selection: top edge, horizontal center.
  const [anchor, setAnchor] = createSignal<{ top: number; left: number }>();

  const sync = () => {
    const replyable = readReplyableSelection(props.container);
    const range = replyable
      ? document.getSelection()?.getRangeAt(0)
      : undefined;
    if (!range) {
      setAnchor(undefined);
      return;
    }
    const rect = range.getBoundingClientRect();
    setAnchor({ top: rect.top, left: rect.left + rect.width / 2 });
  };

  document.addEventListener('selectionchange', sync);
  // Fixed positioning means the chip must follow the text when the
  // transcript scrolls under a live selection (scroll doesn't bubble, so
  // listen in the capture phase).
  document.addEventListener('scroll', sync, { capture: true, passive: true });
  onCleanup(() => {
    document.removeEventListener('selectionchange', sync);
    document.removeEventListener('scroll', sync, { capture: true });
  });

  // Lag the appearance so the chip doesn't flash while a selection is being
  // dragged out. Disappearance is immediate: `Show` also needs a live anchor.
  const show = debouncedDependent(() => anchor() !== undefined, 100);

  const reply = () => {
    const text = readReplyableSelection(props.container);
    document.getSelection()?.removeAllRanges();
    setAnchor(undefined);
    if (text) props.onReply(text);
  };

  return (
    <Show when={show() && anchor()}>
      {(a) => (
        <ScopedPortal scope="block">
          <button
            type="button"
            class="fixed z-highlight-menu flex -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-full border border-edge bg-surface px-2.5 py-1 text-xs font-medium text-ink shadow-lg hover:overlay-hover"
            style={{ top: `${a().top - SPACING_PX}px`, left: `${a().left}px` }}
            on:mousedown={(event: MouseEvent) => {
              // Keep the selection alive through the click: a default
              // mousedown would collapse it, hiding the chip before the
              // click lands and leaving nothing to quote.
              event.preventDefault();
            }}
            onClick={reply}
          >
            <Quote class="size-3.5 shrink-0" />
            Reply to this
          </button>
        </ScopedPortal>
      )}
    </Show>
  );
}
