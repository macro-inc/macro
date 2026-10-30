import { fireAndForget } from '@core/util/fireAndForget';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { Button, TextField } from '@ui';
import { createSignal, Show } from 'solid-js';

/** Describe a routine in words and let AI draft its triggers and steps. */
export function RoutineDescribe(props: {
  /** Resolves to an error message, or nothing once the draft is applied. */
  onDescribe(description: string): Promise<string | undefined>;
  /** A description to revise, e.g. the one the current draft came from. */
  initialValue?: string;
  disabled?: boolean;
}) {
  const [description, setDescription] = createSignal(props.initialValue ?? '');
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const submit = async () => {
    const text = description().trim();
    if (!text || pending()) return;
    setPending(true);
    setError(undefined);
    try {
      const failure = await props.onDescribe(text);
      setError(failure);
      if (!failure) setDescription('');
    } finally {
      setPending(false);
    }
  };
  return (
    <section
      aria-label="Describe your routine"
      class="grid gap-2 rounded-xl border border-edge-muted bg-surface p-3"
    >
      <TextField
        value={description()}
        onChange={setDescription}
        disabled={props.disabled || pending()}
      >
        <TextField.Label class="sr-only">Describe your routine</TextField.Label>
        <TextField.TextArea
          autoResize
          rows={3}
          autofocus
          class="border-none bg-transparent text-base shadow-none"
          placeholder="Describe what should happen, and when. “When an invoice arrives, label it Finance and make a task to pay it.”"
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.stopPropagation();
              fireAndForget(submit(), 'routines');
            }
          }}
        />
      </TextField>
      <div class="flex items-center justify-between gap-2">
        <Show when={error()} fallback={<span />}>
          {(message) => (
            <span role="alert" class="text-xs text-failure">
              {message()}
            </span>
          )}
        </Show>
        <Button
          size="sm"
          variant="primary"
          class="shrink-0 gap-1.5"
          disabled={props.disabled || pending() || !description().trim()}
          onClick={() => fireAndForget(submit(), 'routines')}
        >
          <SparkleIcon class="size-3.5" />
          {pending() ? 'Drafting…' : 'Draft it'}
        </Button>
      </div>
    </section>
  );
}
