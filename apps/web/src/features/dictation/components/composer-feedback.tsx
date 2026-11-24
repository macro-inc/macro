import { Show } from 'solid-js';
import type { DictationMessageTone } from '../core/types';

/** One line under a composer about its last recording, aligned with the text. */
export function ComposerFeedback(props: {
  text: string | undefined;
  tone: DictationMessageTone;
}) {
  return (
    <Show when={props.text}>
      <p
        role="status"
        class="w-full px-4 pt-1 text-left text-xs"
        classList={{
          'text-ink-muted': props.tone === 'info',
          'text-failure-ink': props.tone === 'error',
        }}
      >
        {props.text}
      </p>
    </Show>
  );
}
