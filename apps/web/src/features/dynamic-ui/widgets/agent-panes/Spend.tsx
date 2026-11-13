import { PlotChart } from '@app/features/database-query/components/plot-chart';
import type { QueryChartData } from '@app/features/database-query/core/query-chart';
import { formatLocale, t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { thrownResultErrorHasCode } from '@core/util/result';
import { createElementSize } from '@solid-primitives/resize-observer';
import { useQuery } from '@tanstack/solid-query';
import { Tabs } from '@ui';
import { createMemo, createSignal, Match, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { type SpendBar, spendBars, spendTotal } from '../../core/spend';
import type { SpendBucket } from '../../generated/types';
import { agentSpendQueryOptions } from '../../queries/agent-panes';
import type { WidgetOf } from '../../view';
import { AgentPane } from '../panes/agent-pane';
import {
  NO_ACCESS_CODES,
  NoAccess,
  PaneLoading,
  PaneMessage,
  usePaneDense,
} from '../panes/pane';

export type SpendProps = Omit<WidgetOf<'spend'>, 'type'>;

const SERIES = 'Cost';

/**
 * An agent's AI cost as bars, one per day, week, month or year, drawn like a
 * document's live-answer chart. The view picks the period; the viewer can
 * switch it. Readable by the agent, and by owners and admins of its teams.
 */
export function Spend(props: SpendProps) {
  const dense = usePaneDense(() => props.dense);
  const [chosen, setChosen] = createSignal<SpendBucket>();
  const bucket = () => chosen() ?? props.bucket ?? 'day';
  return (
    <AgentPane
      type="spend"
      agentId={props.agentId}
      title={props.title ?? t('dynamicUi.spend')}
      dense={dense()}
      attributes={{ 'spend.bucket': bucket() }}
      trailing={
        <Tabs
          aria-label={t('dynamicUi.spendPeriod')}
          size="sm"
          touch="inset"
          options={[
            { value: 'day', label: t('dynamicUi.day') },
            { value: 'week', label: t('dynamicUi.week') },
            { value: 'month', label: t('dynamicUi.month') },
            { value: 'year', label: t('dynamicUi.year') },
          ]}
          value={bucket()}
          onChange={(value) => setChosen(value as SpendBucket)}
        />
      }
    >
      {(agentId) => (
        <SpendChart agentId={agentId} bucket={bucket()} dense={dense()} />
      )}
    </AgentPane>
  );
}

function SpendChart(props: {
  agentId: string;
  bucket: SpendBucket;
  dense: boolean;
}) {
  const query = useQuery(() =>
    agentSpendQueryOptions(props.agentId, props.bucket)
  );
  usePending('dynamic_ui.pane.load', () => query.isPending, {
    'spend.bucket': props.bucket,
  });
  const noAccess = () =>
    query.isError &&
    NO_ACCESS_CODES.some((code) => thrownResultErrorHasCode(query.error, code));
  const bars = createMemo(() =>
    query.isSuccess
      ? spendBars(
          query.data.bucket,
          query.data.from,
          query.data.until,
          query.data.buckets
        )
      : []
  );
  return (
    <Switch
      fallback={
        <Chart bars={bars()} bucket={props.bucket} dense={props.dense} />
      }
    >
      <Match when={query.isPending}>
        <PaneLoading dense={props.dense} />
      </Match>
      <Match when={noAccess()}>
        <NoAccess dense={props.dense} />
      </Match>
      <Match when={query.isError}>
        <PaneMessage dense={props.dense}>{t('dynamicUi.failed')}</PaneMessage>
      </Match>
    </Switch>
  );
}

function Chart(props: {
  bars: SpendBar[];
  bucket: SpendBucket;
  dense: boolean;
}) {
  const [element, setElement] = createSignal<HTMLElement>();
  const size = createElementSize(element);
  const width = () => Math.max(180, size.width || 320);
  const money = () =>
    new Intl.NumberFormat(formatLocale(), {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    });
  const label = (start: Date) => periodLabel(props.bucket, start);
  const data = createMemo<QueryChartData>(() => ({
    mark: 'bar',
    config: { x: 'period', y: [SERIES] },
    stack: false,
    title: t('dynamicUi.spend'),
    scale: 'category',
    categories: props.bars.map((bar) => label(bar.start)),
    series: [SERIES],
    points: props.bars.map((bar) => ({
      x: label(bar.start),
      label: label(bar.start),
      series: SERIES,
      value: bar.costUsd,
      tip: `${label(bar.start)}: ${money().format(bar.costUsd)}`,
    })),
    omitted: 0,
  }));
  return (
    <div ref={setElement} class="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
      <div
        class={
          props.dense
            ? 'text-lg font-medium tabular-nums text-ink'
            : 'text-2xl font-medium tabular-nums text-ink'
        }
      >
        {money().format(spendTotal(props.bars))}
      </div>
      <PlotChart
        data={data()}
        width={width()}
        label={t('dynamicUi.spendChart', {
          total: money().format(spendTotal(props.bars)),
        })}
      />
    </div>
  );
}

function periodLabel(bucket: SpendBucket, start: Date): string {
  const options = match(bucket)
    .returnType<Intl.DateTimeFormatOptions>()
    .with('day', 'week', () => ({ month: 'short', day: 'numeric' }))
    .with('month', () => ({ month: 'short', year: '2-digit' }))
    .with('year', () => ({ year: 'numeric' }))
    .exhaustive();
  return new Intl.DateTimeFormat(formatLocale(), {
    ...options,
    timeZone: 'UTC',
  }).format(start);
}
