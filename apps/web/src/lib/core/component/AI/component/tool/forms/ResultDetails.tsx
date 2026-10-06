import { For, Show } from 'solid-js';
import type { FormMutation, SavedForm } from './types';

export function SavedFormDetails(props: { saved: SavedForm }) {
  return (
    <div class="space-y-2 text-sm">
      <p class="font-medium">{props.saved.form.name}</p>
      <p class="text-ink-muted">
        {props.saved.acceptingResponses
          ? 'Accepting responses'
          : 'Not accepting responses'}{' '}
        ·{' '}
        {props.saved.form.audience === 'public'
          ? 'Anyone with the link'
          : 'People with access'}
      </p>
      <Show when={!props.saved.projected}>
        <p class="text-ink-muted">
          Draft saved; the respondent page still needs a valid projection.
        </p>
      </Show>
      <div class="flex flex-wrap gap-3">
        <a class="text-accent hover:underline" href={props.saved.editorUrl}>
          Open builder
        </a>
        <a class="text-accent hover:underline" href={props.saved.respondentUrl}>
          Respondent link
        </a>
      </div>
      <For each={props.saved.layout.sections}>
        {(section) => (
          <div class="border-t border-edge-muted pt-2">
            <p>
              {section.title ||
                (section.kind === 'questions'
                  ? 'Questions'
                  : section.kind === 'gate'
                    ? 'Screener'
                    : 'Booking')}
            </p>
            <Show when={section.kind === 'questions' && section}>
              {(questions) => (
                <ul class="mt-1 list-inside list-disc text-ink-muted">
                  <For each={questions().questions}>
                    {(question) => (
                      <li>
                        {props.saved.columns.find(
                          (column) => column.id === question.column
                        )?.name ?? 'Unavailable question'}
                        {question.required ? ' (required)' : ''}
                        <Show when={question.helpText}>
                          {' '}
                          — {question.helpText}
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              )}
            </Show>
            <Show when={section.kind === 'gate' && section}>
              {(gate) => (
                <p class="text-ink-muted">
                  Qualifying answers continue; otherwise: {gate().message}
                </p>
              )}
            </Show>
            <Show when={section.kind === 'booking'}>
              <p class="text-ink-muted">
                Booking is revealed after an accepted response. Its direct link
                remains usable independently.
              </p>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}
export function MutationDetails(props: { result: FormMutation }) {
  return (
    <div class="space-y-3">
      <Show when={props.result.saved}>
        {(saved) => <SavedFormDetails saved={saved()} />}
      </Show>
      <For each={props.result.diagnostics}>
        {(diagnostic) => (
          <p role="status" class="text-sm text-ink-muted">
            {diagnostic.message}
          </p>
        )}
      </For>
      <Show
        when={
          props.result.state === 'partiallyApplied' ||
          props.result.state === 'pending'
        }
      >
        <p class="text-sm text-ink-muted">
          Some work may have saved. Ask the agent to inspect this operation
          before retrying.
        </p>
      </Show>
    </div>
  );
}
