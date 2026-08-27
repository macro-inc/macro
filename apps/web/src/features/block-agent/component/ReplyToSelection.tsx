/**
 * ChatGPT / Claude-style quote-reply: selecting transcript text floats a
 * "Reply to this" chip over the selection; choosing it hands the selected
 * text to `onReply` (the composer inserts it as a referenced paste chip).
 */

import { floatWithSelection } from '@core/component/LexicalMarkdown/directive/floatWithSelection';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { isMobile } from '@core/mobile/isMobile';
import { debouncedDependent } from '@core/util/debounce';
import Quote from '@phosphor/quotes.svg';
import { Button, Layer } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';
import { readReplyableSelection } from '../state/reply-selection';

false && floatWithSelection;

export function ReplyToSelection(props: {
  /** Selections outside this element (e.g. in the composer) are ignored. */
  container: HTMLElement | undefined;
  onReply: (text: string) => void;
}) {
  // On mobile the native selection toolbar takes this chip's place (the
  // FloatingFormatMenu rule).
  if (isMobile()) return '';

  const [domSelection, setDomSelection] = createSignal<Selection>();
  // Lag the appearance so the chip doesn't flash while a selection is being
  // dragged out (same delay as the floating format menu). Disappearance is
  // immediate: the `Show` below also requires a live selection.
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
          <Layer depth={2}>
            <div
              class="fixed top-0 left-0 z-highlight-menu"
              use:floatWithSelection={{
                selection: selection(),
                reactiveOnContainer: props.container,
                useBlockBoundary: true,
                moveWithSelection: true,
              }}
            >
              <Button
                variant="outline"
                size="sm"
                class="rounded-full shadow-xl border-edge bg-surface"
                on:mousedown={(event: MouseEvent) => {
                  // Keep the selection alive through the click: a default
                  // mousedown would collapse it, hiding the chip before the
                  // click lands and leaving nothing to quote.
                  event.preventDefault();
                }}
                onClick={reply}
              >
                <Quote class="size-4 shrink-0" />
                Reply to this
              </Button>
            </div>
          </Layer>
        </ScopedPortal>
      )}
    </Show>
  );
}
