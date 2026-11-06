import { fireAndForget } from '@core/util/fireAndForget';
import CheckIcon from '@icon/system/regular/check.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { Button, cn } from '@ui';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import type { StepAuthor } from '../context/routine-slots';
import { type Knob, knobText, sentenceText } from '../core/knobs';
import type { CodeStepDraft } from '../core/routine-steps';
import { type DiffPart, diffLines, diffWords } from '../core/text-diff';
import { isComposing } from './composing';

/**
 * A box under a code step, opened by its Edit, where its owner says what to
 * change. AI rewrites the step and checks it; nothing changes until they
 * keep the result. Esc or Cancel closes it.
 */
export function StepChange(props: {
  step: CodeStepDraft;
  author: StepAuthor;
  onRevised(step: CodeStepDraft): void;
  onCancel(): void;
}) {
  const [instruction, setInstruction] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  // A rewrite that lands after Cancel is dropped.
  let open = true;
  onCleanup(() => {
    open = false;
  });
  const submit = async () => {
    const text = instruction().trim();
    if (!text || pending()) return;
    setPending(true);
    setError(undefined);
    const result = await props.author.revise(props.step, text);
    if (!open) return;
    setPending(false);
    if (typeof result === 'string') {
      setError(result);
      return;
    }
    setInstruction('');
    props.onRevised(result);
  };
  return (
    <div class="grid min-w-0 gap-1.5">
      <form
        class="flex min-h-10 min-w-0 items-center gap-2 rounded-xl border border-edge-frame bg-control py-1 pl-3 pr-1 focus-within:ring-1 focus-within:ring-edge"
        onSubmit={(event) => {
          event.preventDefault();
          fireAndForget(submit(), 'routines');
        }}
      >
        <SparkleIcon class="size-3.5 shrink-0 text-accent" />
        <input
          // The step's Edit focuses it once its menu has closed.
          data-step-change
          type="text"
          class="min-w-0 flex-1 bg-transparent text-sm text-ink caret-accent outline-none placeholder:text-ink-placeholder"
          aria-label="Change this step"
          placeholder="Change this step… “also include overdue tasks”"
          value={instruction()}
          disabled={pending()}
          onInput={(event) => setInstruction(event.currentTarget.value)}
          onKeyDown={(event) => {
            // Enter that confirms an IME candidate isn't a request yet.
            if (event.key === 'Enter' && isComposing(event))
              event.preventDefault();
            if (event.key === 'Escape' && !isComposing(event)) {
              event.preventDefault();
              props.onCancel();
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => props.onCancel()}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={pending() || !instruction().trim()}
        >
          {pending() ? 'Rewriting…' : 'Change'}
        </Button>
      </form>
      <Show when={error()}>
        {(message) => (
          <p role="alert" class="px-1 text-xs text-failure">
            {message()}
          </p>
        )}
      </Show>
    </div>
  );
}

/** What a step says it does, in words, with its values filled in. */
function stepWords(step: CodeStepDraft): string {
  return sentenceText(step.sentence, step.knobs) ?? step.summary;
}

/** How the rewrite changed the owner's values, one line each. */
export function changedValues(before: Knob[], after: Knob[]): string[] {
  const lines: string[] = [];
  for (const knob of after) {
    const old = before.find((item) => item.name === knob.name);
    if (!old) lines.push(`New: ${knob.label} (${knobText(knob)})`);
    else if (old.value !== knob.value)
      lines.push(`${knob.label}: ${knobText(old)} → ${knobText(knob)}`);
  }
  for (const old of before)
    if (!after.some((knob) => knob.name === old.name))
      lines.push(`Removed: ${old.label}`);
  return lines;
}

/**
 * A rewritten step before it replaces the old one: what it now does, with
 * the new words marked, whether it checked, and its code changes on request.
 */
export function StepRevision(props: {
  before: CodeStepDraft;
  after: CodeStepDraft;
  onKeep(): void;
  onUndo(): void;
}) {
  const [showCode, setShowCode] = createSignal(false);
  const words = () =>
    diffWords(stepWords(props.before), stepWords(props.after));
  const values = () => changedValues(props.before.knobs, props.after.knobs);
  const problems = () =>
    props.after.problems?.length ? props.after.problems : undefined;
  return (
    <section aria-label="Rewritten step" class="grid min-w-0 gap-3">
      <p class="text-base leading-8 text-ink-muted">
        <For each={words()}>{(part) => <WordChange part={part} />}</For>
      </p>
      <div
        class={cn(
          'grid min-w-0 gap-2 rounded-xl border px-3 py-2.5',
          problems()
            ? 'border-failure/30 bg-failure-bg'
            : 'border-edge-frame bg-control'
        )}
      >
        <Show
          when={problems()}
          fallback={
            <span class="flex items-center gap-1.5 text-sm text-ink">
              <CheckIcon class="size-3.5 shrink-0 text-success" />
              Rewritten and checked
            </span>
          }
        >
          {(problems) => (
            <div role="alert" class="grid min-w-0 gap-1.5">
              <span class="text-sm text-failure">
                Rewritten, but it doesn’t type-check against Macro’s SDK, so it
                can’t be kept. Undo and try saying it differently.
              </span>
              <For each={problems()}>
                {(problem) => (
                  <pre class="min-w-0 overflow-auto whitespace-pre-wrap font-mono text-xs text-ink-muted">
                    {problem}
                  </pre>
                )}
              </For>
            </div>
          )}
        </Show>
        <span class="text-xs text-ink-muted">
          <Show
            when={values().length ? values() : undefined}
            fallback="Your values stay as they are."
          >
            {(lines) => lines().join(' · ')}
          </Show>
        </span>
        <div class="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="primary"
            disabled={!!problems()}
            onClick={() => props.onKeep()}
          >
            Keep
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => props.onUndo()}
          >
            Undo
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-expanded={showCode()}
            onClick={() => setShowCode(!showCode())}
          >
            {showCode() ? 'Hide code changes' : 'Show code changes'}
          </Button>
        </div>
      </div>
      <Show when={showCode()}>
        <CodeChanges before={props.before.source} after={props.after.source} />
      </Show>
    </section>
  );
}

function WordChange(props: { part: DiffPart }) {
  // Spaces around a change stay plain, so the mark fits its words.
  const pieces = () => props.part.text.match(/^(\s*)(.*?)(\s*)$/s) ?? [];
  return (
    <>
      {props.part.change === 'same' ? (
        props.part.text
      ) : (
        <>
          {pieces()[1]}
          {props.part.change === 'added' ? (
            <ins class="rounded-sm bg-accent/20 px-0.5 text-ink no-underline">
              {pieces()[2]}
            </ins>
          ) : (
            <del class="text-ink-extra-muted">{pieces()[2]}</del>
          )}
          {pieces()[3]}
        </>
      )}
    </>
  );
}

/** A source diff, line by line: added lines green, removed lines red. */
function CodeChanges(props: { before: string; after: string }) {
  const lines = () =>
    diffLines(props.before, props.after).flatMap((part) =>
      part.text
        .split(/(?<=\n)/)
        .filter(Boolean)
        .map((text) => ({ text: text.replace(/\n$/, ''), change: part.change }))
    );
  return (
    <pre
      aria-label="Code changes"
      class="max-h-80 min-w-0 overflow-auto rounded-xl border border-edge-frame bg-control py-2 font-mono text-xs leading-relaxed"
    >
      <For each={lines()}>
        {(line) => (
          <span
            class={cn(
              'block whitespace-pre px-3',
              line.change === 'added' && 'bg-success-bg text-success',
              line.change === 'removed' && 'bg-failure-bg text-failure',
              line.change === 'same' && 'text-ink-muted'
            )}
          >
            {line.change === 'added'
              ? '+ '
              : line.change === 'removed'
                ? '- '
                : '  '}
            {line.text}
          </span>
        )}
      </For>
    </pre>
  );
}
