import { createSignal, onCleanup } from 'solid-js';
import type { EventEditorInitialValues } from '../components/composer/event-form-model';

/** Late suggestions only seed an untouched, still-mounted composer session. */
export function createComposerSuggestions(input: {
  suggestion?: Promise<Partial<EventEditorInitialValues>>;
  isDirty: () => boolean;
  apply: (values: Partial<EventEditorInitialValues>) => void;
}) {
  const [pending, setPending] = createSignal(input.suggestion !== undefined);
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  const applySuggestion = async () => {
    if (!input.suggestion) return;
    try {
      const values = await input.suggestion;
      if (!disposed && !input.isDirty()) input.apply(values);
    } finally {
      if (!disposed) setPending(false);
    }
  };

  return { pending, completion: applySuggestion() };
}
