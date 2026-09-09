import Check from '@phosphor/check.svg';
import { For, Show } from 'solid-js';
import type { AnsweredQuestion } from './types';

export interface QuestionAnswersProps {
  questions: AnsweredQuestion[];
}

/** Transcript of the user's choices; the controls are intentionally read-only. */
export function QuestionAnswers(props: QuestionAnswersProps) {
  return (
    <div class="space-y-4 p-4">
      <For each={props.questions}>
        {(item) => (
          <section>
            <h4 class="mb-3 text-sm font-medium text-ink">{item.question}</h4>
            <div class="space-y-2">
              <Show
                when={item.answers.length}
                fallback={<p class="text-xs text-ink-extra-muted">No answer</p>}
              >
                <For each={item.answers}>
                  {(answer) => (
                    <div class="flex items-start gap-3 rounded-xl border border-edge-muted bg-ink/4 px-3 py-2.5 text-sm text-ink">
                      <Check class="mt-0.5 size-4 shrink-0 text-success" />
                      <span class="wrap-break-word">{answer}</span>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </section>
        )}
      </For>
    </div>
  );
}
