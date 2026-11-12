import { Key } from '@solid-primitives/keyed';
import { cn } from '@ui/utils/classname';
import { createMemo, createSignal, on, onCleanup, onMount } from 'solid-js';
import { TextShimmer } from './TextShimmer';
import { WorkingDots } from './WorkingDots';

/** One step an agent is taking or took, worded for a person. */
export type ActivityLineStep = {
  id: string;
  label: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
};

export interface ActivityLineProps {
  steps: readonly ActivityLineStep[];
  /** The session's live status line, which stands for the steps it names. */
  summary?: string;
  class?: string;
}

/** How long each of several steps running at once holds the line. */
const CYCLE_MS = 2000;

/**
 * An open run of steps as one shimmering line: the step the agent is on,
 * sliding in as it moves to the next, and taking turns with any others
 * running at the same time. A channel reply and the session transcript both
 * show their open run this way.
 */
export function ActivityLine(props: ActivityLineProps) {
  const [tick, setTick] = createSignal(0);
  onMount(() => {
    const timer = setInterval(() => setTick((count) => count + 1), CYCLE_MS);
    onCleanup(() => clearInterval(timer));
  });
  const running = () => props.steps.filter((step) => step.status === 'running');
  const runningIds = createMemo(() =>
    running()
      .map((step) => step.id)
      .join('\n')
  );
  // A step that starts takes the line at once; the cycle counts from there.
  const cycleStart = createMemo(on(runningIds, () => tick()));
  const current = () => {
    const active = running();
    if (active.length === 0) return props.steps.at(-1);
    return active.at(-1 - ((tick() - cycleStart()) % active.length));
  };
  const shown = (): ActivityLineStep[] => {
    const summary = props.summary;
    // Keyed by its text, so each new line slides in like a new step.
    if (summary) {
      return [{ id: `summary:${summary}`, label: summary, status: 'running' }];
    }
    const step = current();
    return step ? [step] : [];
  };
  return (
    <div
      class={cn(
        'my-1 flex min-h-6 min-w-0 items-center gap-2 overflow-hidden text-ink-extra-muted',
        props.class
      )}
      role="status"
    >
      <WorkingDots />
      {/* Keyed by step: the next step slides in, while a step repainted as
          new objects keeps its node and its shimmer runs on. */}
      <Key each={shown()} by="id">
        {(step) => (
          <span
            class="flex min-w-0 animate-agent-step-in items-center gap-2 motion-reduce:animate-none"
            data-status={step().status}
          >
            <span class="min-w-0 truncate text-ink-muted">
              <TextShimmer text={step().label} active truncate />
            </span>
          </span>
        )}
      </Key>
    </div>
  );
}
