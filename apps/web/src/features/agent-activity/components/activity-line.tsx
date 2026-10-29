import { TextShimmer, WorkingDots } from '@app/features/block-agent/ui';
import { Key } from '@solid-primitives/keyed';
import {
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { ActivityRowView } from './activity-rows';

/** How long each of several steps running at once holds the line. */
const CYCLE_MS = 2000;

/**
 * An open run of steps as one shimmering line: the step the agent is on,
 * sliding in as it moves to the next, and taking turns with any others
 * running at the same time.
 */
export function ActivityLine(props: { rows: readonly ActivityRowView[] }) {
  const [tick, setTick] = createSignal(0);
  onMount(() => {
    const timer = setInterval(() => setTick((count) => count + 1), CYCLE_MS);
    onCleanup(() => clearInterval(timer));
  });
  const running = () => props.rows.filter((row) => row.status === 'running');
  const runningIds = createMemo(() =>
    running()
      .map((row) => row.id)
      .join('\n')
  );
  // A step that starts takes the line at once; the cycle counts from there.
  const cycleStart = createMemo(on(runningIds, () => tick()));
  const current = () => {
    const active = running();
    if (active.length === 0) return props.rows.at(-1);
    return active.at(-1 - ((tick() - cycleStart()) % active.length));
  };
  const shown = () => {
    const step = current();
    return step ? [step] : [];
  };
  return (
    <div
      class="my-1 flex min-h-6 min-w-0 items-center gap-2 overflow-hidden text-ink-extra-muted"
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
            <span class="shrink-0 text-ink-muted">
              <TextShimmer text={step().label} active />
            </span>
            <Show when={step().detail}>
              {(detail) => (
                <span class="min-w-0 truncate font-mono text-ink-extra-muted">
                  {detail()}
                </span>
              )}
            </Show>
          </span>
        )}
      </Key>
    </div>
  );
}
