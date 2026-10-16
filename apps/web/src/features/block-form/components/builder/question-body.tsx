import CheckSquare from '@phosphor/check-square.svg';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import type { FormColumn, FormOption } from '../../core/form-model';
import type { QuestionTypeId } from '../../core/question-types';
import { ChoiceMarker } from './choice-marker';

function FauxField(props: { children: JSX.Element; tall?: boolean }) {
  return (
    <div
      class={`flex w-full max-w-sm items-start border-b border-dashed border-edge-muted pb-1 text-sm text-ink-placeholder ${props.tall ? 'h-12' : 'h-7'}`}
    >
      {props.children}
    </div>
  );
}

function OptionsPreview(props: {
  options: readonly FormOption[];
  multi: boolean;
  numbered: boolean;
}) {
  return (
    <Show
      when={props.options.length > 0}
      fallback={<p class="text-xs text-ink-muted">No options yet.</p>}
    >
      <ul class="flex flex-col gap-1.5">
        <For each={props.options}>
          {(option, index) => (
            <li class="flex items-center gap-2 text-sm text-ink">
              <Switch>
                <Match when={props.numbered}>
                  <span class="w-4 text-right text-xs text-ink-muted">
                    {index() + 1}.
                  </span>
                </Match>
                <Match when={!props.numbered}>
                  <ChoiceMarker multi={props.multi} />
                </Match>
              </Switch>
              <span class="truncate">{option.label}</span>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}

/** How a question will be asked, drawn small and inert in the builder. */
export function QuestionPreview(props: {
  type: QuestionTypeId;
  column: FormColumn;
  relationTableName?: string;
}): JSX.Element {
  return (
    <Switch>
      <Match when={props.type === 'short'}>
        <FauxField>Short answer text</FauxField>
      </Match>
      <Match when={props.type === 'paragraph'}>
        <FauxField tall>Long answer text</FauxField>
      </Match>
      <Match when={props.type === 'number'}>
        <FauxField>Number</FauxField>
      </Match>
      <Match when={props.type === 'datetime'}>
        <FauxField>Month, day, year, time</FauxField>
      </Match>
      <Match when={props.type === 'date'}>
        <FauxField>Month, day, year</FauxField>
      </Match>
      <Match when={props.type === 'url'}>
        <FauxField>https://</FauxField>
      </Match>
      <Match when={props.type === 'file'}>
        <p class="text-xs text-ink-muted">
          Respondents upload one file. Needs respondents to sign in.
        </p>
      </Match>
      <Match when={props.type === 'checkbox'}>
        <div class="flex items-center gap-2 text-sm text-ink-muted">
          <CheckSquare class="size-4 text-ink-extra-muted" aria-hidden="true" />
          Checked, or left empty
        </div>
      </Match>
      <Match when={props.type === 'person'}>
        <FauxField>Pick a person</FauxField>
      </Match>
      <Match when={props.type === 'document'}>
        <FauxField>Pick a document</FauxField>
      </Match>
      <Match when={props.type === 'entity'}>
        <FauxField>Pick from Macro</FauxField>
      </Match>
      <Match when={props.type === 'relation'}>
        <FauxField>
          Pick a row of {props.relationTableName ?? 'the related table'}
        </FauxField>
      </Match>
      <Match
        when={
          props.type === 'choice' ||
          props.type === 'checkboxes' ||
          props.type === 'dropdown' ||
          props.type === 'tags' ||
          props.type === 'number-dropdown'
        }
      >
        <OptionsPreview
          options={props.column.options}
          multi={props.type === 'checkboxes' || props.type === 'tags'}
          numbered={
            props.type === 'dropdown' || props.type === 'number-dropdown'
          }
        />
      </Match>
    </Switch>
  );
}
