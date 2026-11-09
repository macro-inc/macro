import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { Button, Card, TextField } from '@ui';
import { createSignal, Show } from 'solid-js';
import { isComposing } from './composing';

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
    <section aria-label="Describe your routine" class="grid gap-2">
      {/* One box on the surface above the dialog's, as the template cards
          are; the field fills it and the button sits inside it. */}
      <Card variant="filled" depth={3} class="relative">
        <TextField
          value={description()}
          onChange={setDescription}
          disabled={props.disabled || pending()}
        >
          <TextField.Label class="sr-only">
            Describe your routine
          </TextField.Label>
          <TextField.TextArea
            autoResize
            rows={2}
            // Phones focus on intent: the keyboard would cover the templates.
            autofocus={!isTouchDevice()}
            class="min-h-28 border-transparent bg-transparent px-3.5 pb-12 pt-3 text-[15px] leading-[22px] not-touch:shadow-none"
            placeholder="Describe what should happen, and when. “When an invoice arrives, label it Finance and make a task to pay it.”"
            onKeyDown={(event: KeyboardEvent) => {
              // Enter that confirms an IME candidate isn't a request yet, and
              // on touch Enter is a new line: the button drafts.
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !isComposing(event) &&
                !isTouchDevice()
              ) {
                event.preventDefault();
                event.stopPropagation();
                fireAndForget(submit(), 'routines');
              }
            }}
          />
        </TextField>
        <div class="absolute bottom-2.5 right-2.5">
          <Button
            size="md"
            variant="primary"
            disabled={props.disabled || pending() || !description().trim()}
            onClick={() => fireAndForget(submit(), 'routines')}
          >
            <SparkleIcon class="size-3.5" />
            {pending() ? 'Drafting…' : 'Draft it'}
          </Button>
        </div>
      </Card>
      <Show when={error()}>
        {(message) => (
          <span role="alert" class="px-1 text-xs text-failure">
            {message()}
          </span>
        )}
      </Show>
    </section>
  );
}
