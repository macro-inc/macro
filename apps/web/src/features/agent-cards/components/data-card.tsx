import { AppAnswerDisplay } from '@app/features/database-query/answer-display';
import { QueryResults } from '@app/features/database-query/components/query-results';
import { useAnswerDisplay } from '@app/features/database-query/context/answer-display';
import {
  type QueryAnswer,
  queryErrorMessage,
} from '@app/features/database-query/core/query';
import { availableDisplayModes } from '@app/features/database-query/core/query-chart';
import { createStatementSource } from '@app/features/database-query/queries/app-query-source';
import { isFeatureEnabled, showDatabaseSql } from '@core/constant/featureFlags';
import {
  DATABASE_QUERY_DISPLAY_MODES,
  type DatabaseQueryDisplayMode,
} from '@macro-inc/lexical-core/nodes/databaseQueryData';
import ChartBar from '@phosphor/chart-bar.svg';
import Table from '@phosphor/table.svg';
import { useViewerDatabases } from '@queries/storage/databases';
import { createMemo, type JSX, Match, Show, Switch } from 'solid-js';
import { Card, CardBody, CardHeader } from './kit/card';
import { CardPill, Skeleton, Tile } from './kit/parts';

/**
 * A database answer as a card, from parts already worked out: what it is
 * about, how big it is, and the results themselves.
 */
export function DataCardView(
  props: {
    title: string;
    /** `12 rows`. */
    subtitle?: string;
    /** The answer is a chart rather than rows. */
    chart?: boolean;
    state: 'loading' | 'error' | 'ready';
    /** Why the answer could not be shown. */
    error?: string;
  } & { children?: JSX.Element }
) {
  return (
    <Card width="wide" data-agent-card="data">
      <section aria-label={props.title} class="flex min-h-0 flex-1 flex-col">
        <CardHeader
          center
          tile={<Tile size={32}>{props.chart ? <ChartBar /> : <Table />}</Tile>}
          title={props.title}
          subtitle={props.subtitle}
          trailing={
            <Show when={props.state === 'ready'}>
              <CardPill tone="ok">
                <span
                  class="size-1.5 rounded-full bg-current"
                  aria-hidden="true"
                />
                Live
              </CardPill>
            </Show>
          }
        />
        <CardBody class="pt-2">
          <Switch>
            <Match when={props.state === 'loading'}>
              <div class="flex flex-col gap-2.5 py-1" aria-busy="true">
                <Skeleton width="100%" height="14px" />
                <Skeleton width="92%" height="14px" />
                <Skeleton width="80%" height="14px" />
              </div>
            </Match>
            <Match when={props.state === 'error'}>
              <p class="text-xs text-ink-muted" role="alert">
                {props.error ?? "Couldn't load this answer."}
              </p>
            </Match>
            <Match when={true}>{props.children}</Match>
          </Switch>
        </CardBody>
      </section>
    </Card>
  );
}

function displayMode(
  asked: string | null | undefined,
  answer: QueryAnswer
): DatabaseQueryDisplayMode {
  const modes = availableDisplayModes(answer);
  const wanted = (DATABASE_QUERY_DISPLAY_MODES as readonly string[]).includes(
    asked ?? ''
  )
    ? (asked as DatabaseQueryDisplayMode)
    : undefined;
  return wanted && modes.includes(wanted) ? wanted : modes[0];
}

function Results(props: {
  answer: QueryAnswer;
  mode: DatabaseQueryDisplayMode;
}) {
  const display = useAnswerDisplay();
  const names = display.names(() => props.answer);
  return (
    <QueryResults
      answer={props.answer}
      displayMode={props.mode}
      names={names()}
      display={display}
      compact
      bare
    />
  );
}

/**
 * A database answer the agent asked to show, run again in the browser with
 * the viewer's own access: the table or chart the agent chose, named after
 * the tables it reads, current while it is open.
 */
export function DataCard(props: {
  sql: string;
  databaseId?: string | null;
  display?: string | null;
}) {
  const source = createStatementSource(() => ({
    sql: props.sql,
    databaseId: props.databaseId ?? undefined,
  }));
  const viewer = useViewerDatabases();
  const answer = () => source.answer();
  const mode = createMemo(() => {
    const current = answer();
    return current ? displayMode(props.display, current) : undefined;
  });
  const tables = () => {
    const read = new Set(answer()?.readTables ?? []);
    return (viewer.databases() ?? [])
      .flatMap((database) => database.tables)
      .filter((entry) => read.has(entry.table.id))
      .map((entry) => entry.table.name);
  };
  const rows = () => answer()?.rows.length ?? 0;
  return (
    <AppAnswerDisplay>
      <DataCardView
        title={tables().join(', ') || 'Database answer'}
        subtitle={
          answer() ? `${rows()} ${rows() === 1 ? 'row' : 'rows'}` : undefined
        }
        chart={
          mode() !== undefined && mode() !== 'table' && mode() !== 'scalar'
        }
        state={answer() ? 'ready' : source.error() ? 'error' : 'loading'}
        error={(() => {
          const failure = source.error();
          return failure
            ? queryErrorMessage(failure, isFeatureEnabled(showDatabaseSql))
            : undefined;
        })()}
      >
        <Show when={answer()}>
          {(current) => (
            <Show when={mode()}>
              {(chosen) => <Results answer={current()} mode={chosen()} />}
            </Show>
          )}
        </Show>
      </DataCardView>
    </AppAnswerDisplay>
  );
}
