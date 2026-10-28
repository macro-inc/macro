import { debounce } from '@core/util/debounce';
import { createSignal, onCleanup } from 'solid-js';
import type { Intent, Scores } from '../core/input';
import {
  offeredIntent,
  readSelectedText,
  type SelectedText,
} from '../core/selection';
import { createInferenceQueue } from './inference-queue';

/** Let a drag finish before spending a classification on what it covers. */
const SETTLE_MS = 220;

export type OfferedSelection = SelectedText & { intent: Intent };

/**
 * Watches the reader's text selection and offers the shape the classifier
 * recognizes in it. A host holds the offer while it works with the text,
 * because focusing a draft field moves the caret off the selection.
 */
export function createSelectionOffer(source: {
  classify(
    text: string,
    revision: number
  ): Promise<{ revision: number; scores: Scores }>;
}) {
  const [selected, setSelected] = createSignal<SelectedText>();
  const [offer, setOffer] = createSignal<OfferedSelection>();
  const [revision, setRevision] = createSignal(0);
  let held = false;
  let disposed = false;

  const queue = createInferenceQueue({
    read: () => {
      const current = selected();
      return current && { ...current, revision: revision() };
    },
    key: (input) => String(input.revision),
    async run(input) {
      let scores: Scores;
      try {
        const response = await source.classify(input.text, input.revision);
        if (response.revision !== input.revision) return;
        scores = response.scores;
      } catch {
        // Text the service cannot read simply offers nothing.
        return;
      }
      if (disposed || revision() !== input.revision) return;
      const intent = offeredIntent(scores);
      setOffer(
        intent
          ? {
              text: input.text,
              surface: input.surface,
              container: input.container,
              intent,
            }
          : undefined
      );
    },
  });

  const settle = debounce(() => {
    if (disposed || held) return;
    const current = readSelectedText(document.getSelection());
    // One passage is offered once: a dismissed offer stays dismissed until
    // the reader selects something else.
    if (current?.text === selected()?.text) return;
    setSelected(current);
    setOffer(undefined);
    setRevision((value) => value + 1);
    if (current) queue.enqueue();
    else queue.clear();
  }, SETTLE_MS);

  const onSelectionChange = () => {
    if (!held) settle();
  };
  document.addEventListener('selectionchange', onSelectionChange);
  onCleanup(() => {
    disposed = true;
    document.removeEventListener('selectionchange', onSelectionChange);
    settle.clear();
    queue.dispose();
  });

  return {
    offer,
    /** Keep the offer while a host works with it. */
    hold() {
      held = true;
      settle.clear();
    },
    /** Put the offer away without offering the same passage again. */
    dismiss() {
      held = false;
      setOffer(undefined);
      setRevision((value) => value + 1);
      queue.clear();
    },
  };
}
