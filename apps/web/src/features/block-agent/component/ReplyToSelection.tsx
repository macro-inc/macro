/**
 * ChatGPT / Claude-style quote-reply: selecting transcript text shows a
 * "Reply to this" chip; choosing it hands the selected text to `onReply`
 * (the composer inserts it as a referenced paste chip).
 *
 * Positioning is the same `floatWithSelection` directive the format / mention
 * menus use. This component only decides when the chip is allowed to mount.
 */

import { floatWithSelection } from '@core/component/LexicalMarkdown/directive/floatWithSelection';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { isMobile } from '@core/mobile/isMobile';
import { debouncedDependent } from '@core/util/debounce';
import Quote from '@phosphor/quotes.svg';
import { createSignal, onCleanup, Show } from 'solid-js';
import { readReplyableSelection } from '../state/reply-selection';

false && floatWithSelection;

export function ReplyToSelection(props: {
  /** Selections outside this element (e.g. in the composer) are ignored. */
  container: HTMLElement | undefined;
  onReply: (text: string) => void;
}) {
  // On mobile the native selection toolbar takes this chip's place.
  if (isMobile()) return '';

  const [domSelection, setDomSelection] = createSignal<Selection>();
  // Lag the appearance so the chip doesn't flash while a selection is being
  // dragged out (same delay as the floating format menu).
  const show = debouncedDependent(() => domSelection() !== undefined, 100);

  const syncFromDocument = () => {
    const replyable = readReplyableSelection(props.container);
    setDomSelection(
      replyable ? (document.getSelection() ?? undefined) : undefined
    );
  };

  document.addEventListener('selectionchange', syncFromDocument);
  onCleanup(() => {
    document.removeEventListener('selectionchange', syncFromDocument);
  });

  const reply = () => {
    const text = readReplyableSelection(props.container);
    document.getSelection()?.removeAllRanges();
    setDomSelection(undefined);
    if (text) props.onReply(text);
  };

  return (
    <Show when={show() && domSelection()}>
      {(selection) => (
        <ScopedPortal scope="block">
          <button
            type="button"
            class="fixed top-0 left-0 z-highlight-menu flex items-center gap-1.5 rounded-full border border-edge bg-surface px-2.5 py-1 text-xs font-medium text-ink shadow-lg hover:overlay-hover"
            use:floatWithSelection={{
              selection: selection(),
              reactiveOnContainer: props.container,
              useBlockBoundary: true,
              moveWithSelection: true,
              floatingOptions: { placement: 'top' },
            }}
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
