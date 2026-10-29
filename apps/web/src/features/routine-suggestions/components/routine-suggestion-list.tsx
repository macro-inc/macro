import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import ArrowsClockwiseIcon from '@icon/system/regular/arrows-clockwise.svg';
import { Button } from '@ui';
import { type JSX, Match, Switch } from 'solid-js';
import type { RoutineSuggestion } from '../core/suggestions';
import { RoutineSparkGlyph } from './routine-spark-glyph';

/** What a suggestion list shows. */
export type SuggestionListView =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'empty' }
  | { kind: 'items'; items: RoutineSuggestion[] };

/** Loading, error, and empty states around the host's suggestion rows. */
export function RoutineSuggestionList(props: {
  view: SuggestionListView;
  /** Said when the list is empty, e.g. "No email routines to suggest yet". */
  emptyLabel: string;
  onRetry(): void;
  /** Renders the suggestions once there are some. */
  children: (items: RoutineSuggestion[]) => JSX.Element;
}) {
  return (
    <Switch>
      <Match when={props.view.kind === 'items' && props.view.items}>
        {(items) => props.children(items())}
      </Match>
      <Match when={props.view.kind === 'loading'}>
        <div class="flex flex-col gap-3">
          <p class="flex items-center gap-2 px-3 text-xs text-ink-muted">
            Studying your workspace to suggest routines that fit how you work…
          </p>
          <ListSkeleton.Root label="Finding routines for you">
            {[0, 1, 2].map(() => (
              <div class="flex items-start gap-3 p-3">
                <div class="skeleton-shimmer size-8 shrink-0 rounded-lg bg-skeleton" />
                <div class="flex min-w-0 flex-1 flex-col gap-2 pt-1">
                  <ListSkeleton.Bar class="h-3 w-2/5" />
                  <ListSkeleton.Bar class="w-4/5" />
                  <ListSkeleton.Bar class="w-1/3" />
                </div>
              </div>
            ))}
          </ListSkeleton.Root>
        </div>
      </Match>
      <Match when={props.view.kind === 'error'}>
        <div
          role="alert"
          class="flex flex-col items-center gap-3 px-6 py-10 text-center text-sm text-ink-muted"
        >
          Couldn't load suggestions.
          <Button variant="outline" size="sm" onClick={() => props.onRetry()}>
            <ArrowsClockwiseIcon aria-hidden="true" />
            Try again
          </Button>
        </div>
      </Match>
      <Match when={props.view.kind === 'empty'}>
        <div class="flex flex-col items-center gap-3 px-6 py-10 text-center text-sm text-ink-muted">
          <RoutineSparkGlyph size="md" />
          {props.emptyLabel}
        </div>
      </Match>
    </Switch>
  );
}
