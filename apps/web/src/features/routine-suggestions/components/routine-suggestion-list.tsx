import { t } from '@app/lib/i18n';
import ArrowsClockwiseIcon from '@icon/system/regular/arrows-clockwise.svg';
import { Button } from '@ui';
import { type Accessor, type JSX, Match, Switch } from 'solid-js';
import type { SuggestionItem } from '../core/suggestions';
import { RoutineSparkGlyph } from './routine-spark-glyph';

/** What a suggestion list shows. */
export type SuggestionListView =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'empty' }
  | { kind: 'items'; items: SuggestionItem[] };

/** Loading, error, and empty states around the host's suggestion cards. */
export function RoutineSuggestionList(props: {
  view: SuggestionListView;
  /** Said when the list is empty, e.g. "Nothing to suggest for Email yet". */
  emptyLabel: string;
  /** Placeholder cards where the host's cards will be. */
  skeleton: JSX.Element;
  onRetry(): void;
  /** Renders the suggestions once there are some, following later changes. */
  children: (items: Accessor<SuggestionItem[]>) => JSX.Element;
}) {
  return (
    <Switch>
      <Match when={props.view.kind === 'items' && props.view.items}>
        {(items) => props.children(items)}
      </Match>
      <Match when={props.view.kind === 'loading'}>
        <div class="flex flex-col gap-3">
          <p class="text-xs text-ink-muted">
            {t('routineSuggestions.loading')}
          </p>
          {props.skeleton}
        </div>
      </Match>
      <Match when={props.view.kind === 'error'}>
        <div
          role="alert"
          class="flex flex-col items-center gap-3 px-6 py-10 text-center text-sm text-ink-muted"
        >
          {t('routineSuggestions.failed')}
          <Button variant="secondary" size="sm" onClick={() => props.onRetry()}>
            <ArrowsClockwiseIcon class="size-4" aria-hidden="true" />
            {t('routineSuggestions.retry')}
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
