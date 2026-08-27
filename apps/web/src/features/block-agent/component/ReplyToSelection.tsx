/**
 * ChatGPT / Claude-style quote-reply: when the user selects transcript text,
 * a small "Reply to this" chip floats over the selection. Choosing it inserts
 * a referenced paste chip into the composer.
 */

import { floatWithSelection } from '@core/component/LexicalMarkdown/directive/floatWithSelection';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { debouncedDependent } from '@core/util/debounce';
import Quote from '@phosphor/quotes.svg';
import { Button, Layer } from '@ui';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { readReplyableSelection } from '../state/reply-selection';

false && floatWithSelection;

export function ReplyToSelection(props: {
  container: HTMLElement | undefined;
  onReply: (text: string) => void;
}) {
  const [anchor, setAnchor] = createSignal<Selection | undefined>();
  const show = debouncedDependent(() => anchor() !== undefined, 100);

  const syncFromDocument = () => {
    const text = readReplyableSelection(props.container);
    if (!text) {
      setAnchor(undefined);
      return;
    }
    const sel = document.getSelection();
    setAnchor(sel ?? undefined);
  };

  onMount(() => {
    document.addEventListener('selectionchange', syncFromDocument);
    onCleanup(() => {
      document.removeEventListener('selectionchange', syncFromDocument);
    });
  });

  const reply = () => {
    const text = readReplyableSelection(props.container);
    window.getSelection()?.removeAllRanges();
    setAnchor(undefined);
    if (text) props.onReply(text);
  };

  return (
    <Show when={show() && anchor()}>
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
                spacing: 8,
              }}
            >
              <Button
                variant="outline"
                size="sm"
                class="rounded-full shadow-xl border-edge bg-surface"
                on:mousedown={(event: MouseEvent) => {
                  // Keep the selection alive through the click so we can
                  // still read it, and so the chip doesn't vanish first.
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
