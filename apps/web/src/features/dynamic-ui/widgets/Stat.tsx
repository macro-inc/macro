import { ResultValue } from '@app/features/database-query/components/answer-value';
import { useAnswerDisplay } from '@app/features/database-query/context/answer-display';
import { resultCell } from '@app/features/database-query/core/answer-cell';
import type { QueryAnswer } from '@app/features/database-query/core/query';
import { formatLocale, t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { cn } from '@ui';
import { type JSX, Match, Show, Switch } from 'solid-js';
import type { Query, WidgetOf } from '../view';
import { compileQuery } from './List';
import {
  DataPane,
  Pane,
  PaneLoading,
  PaneMessage,
  usePaneDense,
} from './panes/pane';
import { SavedAnswer } from './panes/saved-answer';
import { Sparkline } from './Sparkline';

export type StatProps = Omit<WidgetOf<'stat'>, 'type'>;

/**
 * One number and its label: a saved question's last row's last column, or
 * how many workspace items a filter matches. A question answering a series
 * (one row per day, oldest first) can also show the change from its previous
 * row and draw the series as a sparkline.
 */
export function Stat(props: StatProps) {
  const dense = usePaneDense(() => props.dense);
  const attributes = (): Record<string, string> =>
    props.source.kind === 'query'
      ? { 'stat.source': 'query', 'query.id': props.source.queryId }
      : { 'stat.source': 'count' };
  return (
    <DataPane type="stat" dense={dense()} attributes={attributes()}>
      <Pane title={props.label} label={props.label} dense={dense()}>
        <Switch>
          <Match when={props.source.kind === 'query' && props.source}>
            {(source) => (
              <SavedAnswer queryId={source().queryId} dense={dense()}>
                {(answer) => (
                  <QueryStat
                    answer={answer()}
                    dense={dense()}
                    delta={props.delta ?? false}
                    sparkline={props.sparkline ?? false}
                  />
                )}
              </SavedAnswer>
            )}
          </Match>
          <Match when={props.source.kind === 'count' && props.source}>
            {(source) => <CountStat query={source().query} dense={dense()} />}
          </Match>
        </Switch>
      </Pane>
    </DataPane>
  );
}

/** The number, sized for a monitor or a compact pane. */
function Figure(props: { dense: boolean; children: JSX.Element }) {
  return (
    <div
      class={cn(
        'min-w-0 truncate font-medium tracking-tight tabular-nums text-ink',
        props.dense ? 'text-xl' : 'text-3xl'
      )}
    >
      {props.children}
    </div>
  );
}

/** A cell's number, when it holds one. */
function numberIn(answer: QueryAnswer, row: number): number | undefined {
  const column = answer.columns.length - 1;
  const definition = answer.columns[column];
  if (!definition) return undefined;
  const cell = resultCell(answer.rows[row]?.[column] ?? null, definition);
  return cell.kind === 'number' ? cell.value : undefined;
}

function QueryStat(props: {
  answer: QueryAnswer;
  dense: boolean;
  delta: boolean;
  sparkline: boolean;
}) {
  const display = useAnswerDisplay();
  const names = display.names(() => props.answer);
  const last = () => props.answer.rows.length - 1;
  const column = () => props.answer.columns[props.answer.columns.length - 1];
  const change = () => {
    const current = numberIn(props.answer, last());
    const previous = numberIn(props.answer, last() - 1);
    if (current === undefined || previous === undefined) return undefined;
    return current - previous;
  };
  // The change as something to show: a zero change shows too, as "+0".
  const delta = () => {
    const value = change();
    return value === undefined ? undefined : { value };
  };
  const series = () =>
    props.answer.rows.flatMap((_, row) => {
      const value = numberIn(props.answer, row);
      return value === undefined ? [] : [value];
    });
  const formattedChange = (value: number) =>
    new Intl.NumberFormat(formatLocale(), {
      signDisplay: 'always',
      maximumFractionDigits: 2,
    }).format(value);
  return (
    <Show
      when={last() >= 0 && column()}
      fallback={
        <PaneMessage dense={props.dense}>{t('dynamicUi.empty')}</PaneMessage>
      }
    >
      {(definition) => (
        <div class="flex min-w-0 flex-col gap-1">
          <div class="flex min-w-0 items-baseline gap-2">
            <Figure dense={props.dense}>
              <ResultValue
                cell={resultCell(
                  props.answer.rows[last()]?.[
                    props.answer.columns.length - 1
                  ] ?? null,
                  definition()
                )}
                names={names()}
                display={display}
              />
            </Figure>
            <Show when={props.delta ? delta() : undefined}>
              {(shownDelta) => (
                <span
                  aria-label={t('dynamicUi.delta', {
                    value: formattedChange(shownDelta().value),
                  })}
                  class={cn(
                    'shrink-0 text-xs tabular-nums',
                    shownDelta().value > 0 && 'text-success',
                    shownDelta().value < 0 && 'text-failure',
                    shownDelta().value === 0 && 'text-ink-muted'
                  )}
                >
                  {formattedChange(shownDelta().value)}
                </span>
              )}
            </Show>
          </div>
          <Show when={props.sparkline}>
            <Sparkline values={series()} label={t('dynamicUi.trend')} />
          </Show>
        </div>
      )}
    </Show>
  );
}

/** The most items a count reads; more show as "100+". */
const COUNT_CAP = 100;

/**
 * How many items a filter matches, up to {@link COUNT_CAP}: one page of the
 * same Soup read a list widget makes, so a count costs no more than a list
 * of the same filter. A server count of every match would need its own read.
 */
function CountStat(props: { query: Query; dense: boolean }) {
  const items = useSoupAstItemsQuery(() => ({
    params: { limit: COUNT_CAP },
    body: compileQuery(props.query),
  }));
  usePending('dynamic_ui.pane.load', () => items.isPending);
  const shown = () => {
    // A failed read has no count; showing 0 would claim nothing matches.
    if (items.isPending || (items.error && !items.data)) return undefined;
    const count = items.data?.entities.length ?? 0;
    const format = new Intl.NumberFormat(formatLocale());
    if (count >= COUNT_CAP && items.hasNextPage)
      return t('dynamicUi.atLeast', { value: COUNT_CAP });
    return format.format(count);
  };
  return (
    <Switch fallback={<PaneLoading dense={props.dense} />}>
      <Match when={items.error && shown() === undefined}>
        <PaneMessage dense={props.dense}>{t('dynamicUi.failed')}</PaneMessage>
      </Match>
      <Match when={shown()}>
        {(value) => <Figure dense={props.dense}>{value()}</Figure>}
      </Match>
    </Switch>
  );
}
