import Plus from '@phosphor/plus.svg';
import X from '@phosphor/x.svg';
import { Button, Checkbox, Input, TextField } from '@ui';
import { createSignal, createUniqueId, Index, Show } from 'solid-js';

import { duplicatePollOptions } from '../../core/poll-options';

export type PollComposerDraft = {
  question: string;
  options: string[];
  multi: boolean;
  showResults: boolean;
};

/**
 * The `/poll` composer: a question, two options to start with and Add
 * option, Multiple answers, and Show results to respondents (on by default).
 */
export function PollComposer(props: {
  pending: boolean;
  error: string | undefined;
  onPost: (draft: PollComposerDraft) => void;
  onCancel: () => void;
}) {
  const [question, setQuestion] = createSignal('');
  const [options, setOptions] = createSignal(['', '']);
  const [multi, setMulti] = createSignal(false);
  const [showResults, setShowResults] = createSignal(true);
  const optionInputs: HTMLInputElement[] = [];
  const focusOption = (index: number) =>
    queueMicrotask(() => optionInputs[index]?.focus());
  const duplicateErrorId = createUniqueId();
  const duplicates = () => duplicatePollOptions(options());
  const filled = () => options().filter((option) => option.trim()).length;
  const ready = () =>
    question().trim().length > 0 && filled() >= 2 && duplicates().size === 0;
  return (
    <form
      class="flex max-h-[75dvh] min-h-0 flex-col"
      aria-label="New poll"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready() || props.pending) return;
        props.onPost({
          question: question(),
          options: options(),
          multi: multi(),
          showResults: showResults(),
        });
      }}
    >
      <fieldset
        disabled={props.pending}
        class="flex min-h-0 flex-col gap-5 overflow-y-auto px-5 pb-5"
      >
        <TextField value={question()} onChange={setQuestion}>
          <TextField.Label>Question</TextField.Label>
          <TextField.Input
            placeholder="What would you like to ask?"
            maxlength={200}
            size="lg"
            class="h-11 bg-page text-sm"
          />
        </TextField>
        <fieldset class="flex flex-col gap-2">
          <legend class="mb-2 text-sm font-medium text-ink">Options</legend>
          <ul class="flex flex-col gap-2">
            <Index each={options()}>
              {(option, index) => (
                <li class="flex items-center gap-2">
                  <Input
                    ref={(element) => {
                      optionInputs[index] = element;
                    }}
                    aria-label={`Option ${index + 1}`}
                    placeholder={`Option ${index + 1}`}
                    value={option()}
                    aria-invalid={duplicates().has(index)}
                    aria-describedby={
                      duplicates().has(index) ? duplicateErrorId : undefined
                    }
                    maxlength={200}
                    size="lg"
                    class="h-11 flex-1 bg-page text-sm"
                    onInput={(event) => {
                      const value = event.currentTarget.value;
                      setOptions((current) =>
                        current.map((item, at) => (at === index ? value : item))
                      );
                    }}
                  />
                  <Show when={options().length > 2}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      label={`Remove option ${index + 1}`}
                      onClick={() => {
                        setOptions((current) =>
                          current.filter((_, at) => at !== index)
                        );
                        focusOption(Math.min(index, options().length - 1));
                      }}
                    >
                      <X />
                    </Button>
                  </Show>
                </li>
              )}
            </Index>
          </ul>
          <Show when={duplicates().size > 0}>
            <p
              id={duplicateErrorId}
              role="alert"
              class="text-xs text-failure-ink"
            >
              Each option needs a different name.
            </p>
          </Show>
          <Button
            type="button"
            variant="outline"
            class="h-10 w-full justify-start border-dashed text-ink-muted"
            disabled={options().length >= 20}
            onClick={() => {
              setOptions((current) => [...current, '']);
              focusOption(options().length - 1);
            }}
          >
            <Plus class="size-4" />
            Add option
          </Button>
        </fieldset>
        <div class="flex flex-col gap-3 border-t border-edge-divider pt-4">
          <Checkbox checked={multi()} onChange={setMulti}>
            <Checkbox.Control />
            <Checkbox.Label class="text-sm">Multiple answers</Checkbox.Label>
          </Checkbox>
          <div class="flex flex-col gap-1.5">
            <Checkbox checked={showResults()} onChange={setShowResults}>
              <Checkbox.Control />
              <Checkbox.Label class="text-sm">
                Show results to respondents
              </Checkbox.Label>
            </Checkbox>
            <p class="pl-6 text-xs leading-5 text-ink-muted">
              {showResults()
                ? 'Voters can see the counts before and after voting.'
                : 'Only you and other editors can see the counts.'}
            </p>
          </div>
        </div>
      </fieldset>
      <Show when={props.error}>
        <p role="alert" class="px-5 pb-3 text-sm text-failure-ink">
          {props.error}
        </p>
      </Show>
      <div class="flex shrink-0 justify-end gap-2 border-t border-edge-divider px-5 py-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={props.onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="cta"
          size="sm"
          disabled={!ready() || props.pending}
          aria-busy={props.pending}
        >
          {props.pending ? 'Posting…' : 'Post poll'}
        </Button>
      </div>
    </form>
  );
}
