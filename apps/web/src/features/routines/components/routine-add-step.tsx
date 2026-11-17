import { fireAndForget } from '@core/util/fireAndForget';
import PlusIcon from '@icon/system/regular/plus.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { Button } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';
import type { StepAuthor } from '../context/routine-slots';
import {
  agentStep,
  type StepDraft,
  type StepKind,
} from '../core/routine-steps';
import { isComposing } from './composing';
import { SearchMenu } from './routine-search-menu';
import { useSteps } from './routine-steps';

/**
 * Under a routine's steps: one box where AI writes the next step from a
 * description, or, where AI can't write steps, "+ Add step" for Ask AI.
 */
export function AddStep(props: {
  steps: StepDraft[];
  onChange(steps: StepDraft[]): void;
}) {
  const steps = useSteps();
  return (
    <Show
      when={steps.author}
      fallback={
        <AddStepMenu onAdd={(step) => props.onChange([...props.steps, step])} />
      }
    >
      {(author) => (
        <AddStepBox
          author={author()}
          steps={props.steps}
          onChange={props.onChange}
        />
      )}
    </Show>
  );
}

/** The step AI just added: what it was asked, and why it chose its kind. */
type Added = {
  id: string;
  kind: StepKind;
  reason: string;
  description: string;
};

function AddStepBox(props: {
  author: StepAuthor;
  steps: StepDraft[];
  onChange(steps: StepDraft[]): void;
}) {
  const steps = useSteps();
  const [description, setDescription] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [added, setAdded] = createSignal<Added>();
  const hasAgent = () => props.steps.some((step) => step.kind === 'agent');
  const without = (id: string) => props.steps.filter((step) => step.id !== id);

  const add = async (text: string, kind?: StepKind) => {
    setPending(true);
    setError(undefined);
    const result = await props.author.add(text, kind);
    setPending(false);
    if (typeof result === 'string') {
      setError(result);
      return false;
    }
    steps.fresh.add(result.step.id);
    props.onChange([...props.steps, result.step]);
    setAdded({
      id: result.step.id,
      kind: result.step.kind === 'agent' ? 'agent' : 'code',
      reason: result.reason,
      description: text,
    });
    return true;
  };

  const submit = async () => {
    const text = description().trim();
    if (!text || pending()) return;
    if (await add(text)) setDescription('');
  };

  /** Write the step just added as the other kind, keeping it if that fails. */
  const switchKind = async (step: Added) => {
    const previous = props.steps.find((item) => item.id === step.id);
    props.onChange(without(step.id));
    if (
      !(await add(step.description, step.kind === 'code' ? 'agent' : 'code'))
    ) {
      if (previous) props.onChange([...props.steps, previous]);
      setAdded(step);
    }
  };

  const undo = (step: Added) => {
    props.onChange(without(step.id));
    setAdded(undefined);
  };

  // Gone once its step is removed or changed by other means.
  const current = () => {
    const step = added();
    return step && props.steps.some((item) => item.id === step.id)
      ? step
      : undefined;
  };

  return (
    <div class="grid w-full min-w-0 gap-2 py-1">
      <form
        class="flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-edge-frame bg-control py-1 pl-3 pr-1 focus-within:ring-1 focus-within:ring-edge"
        onSubmit={(event) => {
          event.preventDefault();
          fireAndForget(submit(), 'routines');
        }}
      >
        <SparkleIcon class="size-4 shrink-0 text-accent" />
        <input
          type="text"
          class="min-w-0 flex-1 bg-transparent text-sm text-ink caret-accent outline-none placeholder:text-ink-placeholder"
          aria-label="Add a step"
          placeholder="Then… say what should happen next"
          value={description()}
          disabled={pending()}
          onInput={(event) => setDescription(event.currentTarget.value)}
          onKeyDown={(event) => {
            // Enter that confirms an IME candidate isn't a request yet.
            if (event.key === 'Enter' && isComposing(event))
              event.preventDefault();
          }}
        />
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={pending() || !description().trim()}
        >
          {pending() ? 'Writing…' : 'Add'}
        </Button>
      </form>
      <Show when={error()}>
        {(message) => (
          <p role="alert" class="px-1 text-xs text-failure">
            {message()}
          </p>
        )}
      </Show>
      <Show when={current()}>
        {(step) => (
          <p
            role="status"
            class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-ink-muted"
          >
            <span class="min-w-0">
              {step().kind === 'code'
                ? 'Added as a step that runs the same way every time'
                : 'Added as Ask AI, which decides each run'}
              {step().reason ? `: ${step().reason}` : '.'}
            </span>
            <Show
              when={step().kind === 'agent' ? props.author.code() : !hasAgent()}
            >
              <LinkButton
                disabled={pending()}
                onClick={() => fireAndForget(switchKind(step()), 'routines')}
              >
                {step().kind === 'code'
                  ? 'Ask AI each run instead'
                  : 'Write it once instead'}
              </LinkButton>
            </Show>
            <LinkButton disabled={pending()} onClick={() => undo(step())}>
              Undo
            </LinkButton>
          </p>
        )}
      </Show>
    </div>
  );
}

/** A text action inside a line of muted text. */
export function LinkButton(props: {
  disabled?: boolean;
  onClick(): void;
  children: JSX.Element;
}) {
  return (
    <button
      type="button"
      class="shrink-0 text-ink underline decoration-edge underline-offset-2 hover:decoration-ink disabled:opacity-50"
      disabled={props.disabled}
      onClick={() => props.onClick()}
    >
      {props.children}
    </button>
  );
}

/** "+ Add step" where AI can't write steps: only Ask AI is added by hand. */
function AddStepMenu(props: { onAdd(step: StepDraft): void }) {
  const steps = useSteps();
  const add = (step: StepDraft) => {
    steps.fresh.add(step.id);
    props.onAdd(step);
  };
  // A routine hands off to AI once.
  const hasAgent = () => steps.steps().some((step) => step.kind === 'agent');
  return (
    <SearchMenu
      label="Add step"
      triggerVariant="ghost"
      triggerSize="sm"
      trigger={
        <>
          <PlusIcon class="size-3.5" />
          Add step
        </>
      }
      placeholder="Search steps"
      sections={
        hasAgent()
          ? []
          : [
              {
                label: 'Hand off',
                items: [
                  {
                    key: 'agent',
                    label: 'Ask AI',
                    keywords: 'agent model instructions',
                    description:
                      'Hand the rest to a model or agent with instructions. One per routine.',
                    icon: SparkleIcon,
                    ai: true,
                    hint: '1 per routine',
                    onSelect: () => add(agentStep(steps.defaultTarget())),
                  },
                ],
              },
            ]
      }
      footer={`${hasAgent() ? 'This routine already has its Ask AI step. ' : ''}Code steps are written by AI: describe what you want with Draft it, or ask AI to change the routine.`}
      width="w-72"
    />
  );
}
