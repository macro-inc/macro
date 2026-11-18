import CheckIcon from '@icon/system/regular/check.svg';
import CircleDashedIcon from '@icon/system/regular/circle-dashed.svg';
import { Button, Card, Spinner } from '@ui';
import { Index, Match, Show, Switch } from 'solid-js';
import type { DraftMilestone } from '../core/draft-progress';

function Milestone(props: { milestone: DraftMilestone }) {
  return (
    <li class="flex items-start gap-2.5 py-1 text-sm">
      <span class="flex size-5 shrink-0 items-center justify-center">
        <Switch>
          <Match when={props.milestone.state === 'done'}>
            <CheckIcon class="size-4 text-success" />
          </Match>
          <Match when={props.milestone.state === 'now'}>
            <Spinner size="sm" decorative />
          </Match>
          <Match when={props.milestone.state === 'next'}>
            <CircleDashedIcon class="size-4 text-ink-extra-muted" />
          </Match>
        </Switch>
      </span>
      <span class="grid min-w-0">
        <Switch>
          <Match when={props.milestone.state === 'now'}>
            <span class="text-ink">{props.milestone.label}…</span>
          </Match>
          <Match when={props.milestone.state === 'done'}>
            <span class="text-ink-muted">{props.milestone.label}</span>
          </Match>
          <Match when={props.milestone.state === 'next'}>
            <span class="text-ink-extra-muted">{props.milestone.label}</span>
          </Match>
        </Switch>
        <Show when={props.milestone.detail}>
          <span class="text-xs text-ink-muted">{props.milestone.detail}</span>
        </Show>
      </span>
    </li>
  );
}

/**
 * A routine drafting, in the describe box's place: what was asked for, the
 * milestones it has passed and the one under way, and a way to stop it.
 */
export function RoutineDraftProgress(props: {
  request: string;
  milestones: DraftMilestone[];
  onCancel(): void;
}) {
  return (
    <section aria-label="Drafting your routine" class="grid gap-2">
      <Card variant="filled" depth={3} class="grid gap-3 px-3.5 pb-2.5 pt-3">
        <p class="text-[15px] leading-[22px] text-ink-muted wrap-anywhere">
          {props.request}
        </p>
        <ol
          aria-live="polite"
          class="grid gap-0.5 border-t border-edge-muted pt-2.5"
        >
          {/* By position: the three milestones stay, their states move on. */}
          <Index each={props.milestones}>
            {(milestone) => <Milestone milestone={milestone()} />}
          </Index>
        </ol>
        <div class="flex items-center justify-between gap-3">
          <span class="text-xs text-ink-muted">
            Close this anytime. Drafting carries on, and you'll be told when
            it's ready.
          </span>
          <Button
            size="md"
            variant="secondary"
            onClick={() => props.onCancel()}
          >
            Cancel draft
          </Button>
        </div>
      </Card>
    </section>
  );
}
