/**
 * Body of a "question" tool call: each question the agent asked, with the
 * answer(s) the user chose underneath. Body-only — the caller supplies the
 * card chrome.
 *
 * Port of the question renderer from opencode's message-part.tsx —
 * github.com/sst/opencode, MIT © 2025 opencode — adapted to Macro tokens.
 */

import { For } from 'solid-js';
import type { AnsweredQuestion } from './types';

export interface QuestionAnswersProps {
  questions: AnsweredQuestion[];
}

export function QuestionAnswers(props: QuestionAnswersProps) {
  return (
    <div class="flex flex-col gap-3 py-1">
      <For each={props.questions}>
        {(item) => (
          <div class="flex min-w-0 flex-col gap-0.5">
            <div class="text-xs text-ink-muted">{item.question}</div>
            <div class="text-sm text-ink wrap-break-word">
              {item.answers.length > 0 ? (
                item.answers.join(', ')
              ) : (
                <span class="text-ink-placeholder">No answer</span>
              )}
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
