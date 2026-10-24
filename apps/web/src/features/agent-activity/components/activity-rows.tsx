import { ItemChip } from '@app/features/agent-cards/components/item-chip';
import type { ItemFact } from '@app/features/agent-cards/core/run-cards';
import { TextShimmer } from '@app/features/block-agent/ui';
import CaretRight from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import WarningIcon from '@phosphor/warning-circle.svg';
import XIcon from '@phosphor/x.svg';
import { Key } from '@solid-primitives/keyed';
import { cn } from '@ui';
import {
  type Accessor,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';

/** One step of an agent's work, as the session's fold worded it. */
export type ActivityRowView = {
  id: string;
  label: string;
  detail?: string | null;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
};

/** Steps shown before the earlier ones fold behind a count. */
const VISIBLE_ROWS = 6;

/**
 * The steps an agent took between two passages of its reply: what it did, to
 * what, and how that went, one quiet line each, with whatever the agent
 * showed right under the step that showed it. A step that created, changed
 * or sent an item names it, and opens it, on its line. A long run keeps its
 * latest steps in view and folds the rest behind a count, so the newest
 * step is always on screen; what the folded steps showed stays in view
 * above the count.
 *
 * Steps are kept by id: a live run hands over new objects for the same steps
 * several times a second, and a step that only changed its status must not
 * be drawn again, nor anything under it.
 */
export function ActivityRows<Row extends ActivityRowView>(props: {
  rows: readonly Row[];
  /** What a step showed, under its row, by the step's id. */
  after?: (id: string) => JSX.Element;
  /** What the steps folded behind the count showed, by their ids. */
  earlier?: (ids: Accessor<readonly string[]>) => JSX.Element;
  /** The item a step created, changed or sent, named on its line. */
  item?: (row: Row) => ItemFact | undefined;
  /**
   * Steps whose product replaces their line: a view the agent composed is
   * shown where the step ran, with no line of its own.
   */
  inPlace?: (row: Row) => boolean;
  /** Show every step: the reader asked to see the whole run. */
  all?: boolean;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const hidden = () =>
    props.all || expanded() ? 0 : Math.max(0, props.rows.length - VISIBLE_ROWS);
  return (
    <ul class="my-1 flex min-w-0 flex-col gap-0.5 text-xs" aria-label="Steps">
      <Show when={hidden() > 0}>
        <li class="flex min-w-0 flex-col">
          {props.earlier?.(() =>
            props.rows.slice(0, hidden()).map((row) => row.id)
          )}
          <button
            type="button"
            class="self-start text-ink-subtle hover:text-ink-muted"
            onClick={() => setExpanded(true)}
          >
            {hidden()} earlier {hidden() === 1 ? 'step' : 'steps'}
          </button>
        </li>
      </Show>
      <Key each={props.rows.slice(hidden())} by="id">
        {(row) => {
          const id = row().id;
          return (
            <li class="flex min-w-0 flex-col" data-status={row().status}>
              <Show when={!props.inPlace?.(row())}>
                <span class="flex min-h-5 min-w-0 items-center gap-2">
                  <StatusIcon status={row().status} />
                  <span class="shrink-0 text-ink-muted">
                    <TextShimmer
                      text={row().label}
                      active={row().status === 'running'}
                    />
                  </span>
                  <Show
                    when={props.item?.(row())}
                    fallback={
                      <Show when={row().detail}>
                        {(detail) => (
                          <span class="min-w-0 truncate font-mono text-ink-subtle">
                            {detail()}
                          </span>
                        )}
                      </Show>
                    }
                  >
                    {(item) => <ItemChip fact={item()} />}
                  </Show>
                </span>
              </Show>
              {props.after?.(id)}
            </li>
          );
        }}
      </Key>
    </ul>
  );
}

/**
 * A finished run of steps folded into one line, the way a teammate says
 * "worked on it for a minute": how long, and how many steps. Opening it
 * shows the steps exactly as they ran.
 */
export function RunSummary(props: {
  steps: number;
  /** `1m 12s`, when known. */
  duration?: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={props.open}
      class="my-1 flex items-center gap-1 text-xs text-ink-subtle hover:text-ink-muted"
      onClick={() => props.onToggle()}
    >
      <span>
        {props.duration ? `Worked for ${props.duration}` : 'Worked'} ·{' '}
        {props.steps} {props.steps === 1 ? 'step' : 'steps'}
      </span>
      <CaretRight
        class={cn('size-3 transition-transform', props.open && 'rotate-90')}
        aria-hidden="true"
      />
    </button>
  );
}

function StatusIcon(props: { status: ActivityRowView['status'] }) {
  return (
    <Switch>
      <Match when={props.status === 'running'}>
        <SpinnerIcon
          class="size-3.5 shrink-0 animate-spin text-ink-muted"
          aria-label="Running"
        />
      </Match>
      <Match when={props.status === 'completed'}>
        <CheckIcon class="size-3.5 shrink-0 text-success" aria-label="Done" />
      </Match>
      <Match when={props.status === 'failed'}>
        <XIcon class="size-3.5 shrink-0 text-failure" aria-label="Failed" />
      </Match>
      <Match when={props.status === 'interrupted'}>
        <WarningIcon
          class="size-3.5 shrink-0 text-ink-muted"
          aria-label="Interrupted: it may or may not have finished"
        />
      </Match>
    </Switch>
  );
}
