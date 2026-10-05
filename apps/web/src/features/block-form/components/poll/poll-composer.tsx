import Plus from '@phosphor/plus.svg';
import X from '@phosphor/x.svg';
import { Button, ToggleSwitch } from '@ui';
import { createSignal, Index, Show } from 'solid-js';

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
  const filled = () => options().filter((option) => option.trim()).length;
  const ready = () => question().trim().length > 0 && filled() >= 2;
  return (
    <form
      class="flex flex-col gap-3"
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
      <input
        aria-label="Poll question"
        placeholder="Ask a question"
        value={question()}
        maxlength={200}
        class="h-10 w-full rounded-md border border-edge-muted bg-input px-3 text-sm font-medium text-ink outline-none placeholder:text-ink-placeholder focus:border-edge-focus"
        onInput={(event) => setQuestion(event.currentTarget.value)}
      />
      <ul class="flex flex-col gap-1.5">
        <Index each={options()}>
          {(option, index) => (
            <li class="flex items-center gap-1.5">
              <input
                aria-label={`Option ${index + 1}`}
                placeholder={`Option ${index + 1}`}
                value={option()}
                maxlength={200}
                class="h-9 min-w-0 flex-1 rounded-md border border-edge-muted bg-input px-3 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-edge-focus"
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
                  onClick={() =>
                    setOptions((current) =>
                      current.filter((_, at) => at !== index)
                    )
                  }
                >
                  <X />
                </Button>
              </Show>
            </li>
          )}
        </Index>
      </ul>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="self-start"
        disabled={options().length >= 20}
        onClick={() => setOptions((current) => [...current, ''])}
      >
        <Plus class="size-3.5" />
        Add option
      </Button>
      <div class="flex flex-col gap-2">
        <ToggleSwitch
          label="Multiple answers"
          labelClass="text-sm text-ink"
          checked={multi()}
          onChange={setMulti}
        />
        <div class="flex flex-col gap-0.5">
          <ToggleSwitch
            label="Show results to respondents"
            labelClass="text-sm text-ink"
            checked={showResults()}
            onChange={setShowResults}
          />
          <p class="text-xs text-ink-muted">
            {showResults()
              ? 'Everyone who can vote sees the counts, before and after voting.'
              : 'Respondents answer without seeing counts. You and other editors review votes in the Responses tab.'}
          </p>
        </div>
      </div>
      <Show when={props.error}>
        <p role="alert" class="text-xs text-failure-ink">
          {props.error}
        </p>
      </Show>
      <div class="flex justify-end gap-2">
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
