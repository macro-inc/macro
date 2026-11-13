import { QueryChart } from '@app/features/database-query/components/query-chart';
import { useAnswerDisplay } from '@app/features/database-query/context/answer-display';
import type { QueryAnswer } from '@app/features/database-query/core/query';
import { prepareQueryChart } from '@app/features/database-query/core/query-chart';
import { Show } from 'solid-js';
import type { WidgetOf } from '../view';
import { DataPane, Pane, PaneMessage, usePaneDense } from './panes/pane';
import { SavedAnswer } from './panes/saved-answer';

export type ChartProps = Omit<WidgetOf<'chart'>, 'type'>;

/**
 * A saved question's answer as the chart a document's live answer draws:
 * the same marks, palette and labels, re-run as the viewer. Until it can
 * draw, the pane frame holds its place.
 */
export function Chart(props: ChartProps) {
  const dense = usePaneDense(() => props.dense);
  return (
    <DataPane
      type="chart"
      dense={dense()}
      attributes={{ 'query.id': props.queryId, 'chart.mode': props.mode }}
    >
      <SavedAnswer
        queryId={props.queryId}
        dense={dense()}
        frame={(content) => (
          <Pane title={props.chart.title} label={props.chart.x} dense={dense()}>
            {content}
          </Pane>
        )}
      >
        {(answer) => <Drawn {...props} answer={answer()} dense={dense()} />}
      </SavedAnswer>
    </DataPane>
  );
}

function Drawn(props: ChartProps & { answer: QueryAnswer; dense: boolean }) {
  const display = useAnswerDisplay();
  const names = display.names(() => props.answer);
  const chart = () =>
    prepareQueryChart(props.answer, props.mode, props.chart, names());
  return (
    <Show
      when={chart().data}
      fallback={
        <Pane
          title={props.chart.title}
          label={props.chart.x}
          dense={props.dense}
        >
          <PaneMessage dense={props.dense}>{chart().error}</PaneMessage>
        </Pane>
      }
    >
      {(data) => (
        // The chart draws its own frame; it fills a grid cell like a pane.
        <div class="flex h-full min-w-0 flex-col [&>figure]:flex-1">
          <QueryChart data={data()} />
        </div>
      )}
    </Show>
  );
}
