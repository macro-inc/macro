import { DatabaseGrid } from '@app/features/block-database/component/DatabaseGrid';
import { allRecordsView } from '@app/features/database/core/views';
import { QueryResults } from '@app/features/database-query/components/query-results';
import { useAnswerDisplay } from '@app/features/database-query/context/answer-display';
import type { QueryAnswer } from '@app/features/database-query/core/query';
import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { thrownResultErrorHasCode } from '@core/util/result';
import { useDatabaseDetailQuery } from '@queries/storage/databases';
import { useDatabaseTableChangedSync } from '@queries/storage/databases-sync';
import { cn } from '@ui';
import { Match, Switch } from 'solid-js';
import type { WidgetOf } from '../view';
import {
  DataPane,
  NO_ACCESS_CODES,
  NoAccess,
  Pane,
  PaneLoading,
  PaneMessage,
  usePaneDense,
} from './panes/pane';
import { SavedAnswer } from './panes/saved-answer';

export type TableProps = Omit<WidgetOf<'table'>, 'type'>;

/**
 * Rows, read-only, as the viewer may read them: a saved question's answer
 * in the live answer's table, or a database view in the database grid with
 * its filters and sorting. Neither edits: a clicked record opens the
 * database.
 */
export function Table(props: TableProps) {
  const dense = usePaneDense(() => props.dense);
  const attributes = (): Record<string, string> =>
    props.source.kind === 'query'
      ? { 'table.source': 'query', 'query.id': props.source.queryId }
      : {
          'table.source': 'view',
          'database.id': props.source.databaseId,
          'database.view_id': props.source.viewId,
        };
  return (
    <DataPane type="table" dense={dense()} attributes={attributes()}>
      <Pane
        title={props.title}
        label={props.title ?? t('dynamicUi.table')}
        dense={dense()}
      >
        <Switch>
          <Match when={props.source.kind === 'query' && props.source}>
            {(source) => (
              <SavedAnswer queryId={source().queryId} dense={dense()}>
                {(answer) => <AnswerTable answer={answer()} dense={dense()} />}
              </SavedAnswer>
            )}
          </Match>
          <Match when={props.source.kind === 'view' && props.source}>
            {(source) => (
              <ViewTable
                databaseId={source().databaseId}
                viewId={source().viewId}
                dense={dense()}
              />
            )}
          </Match>
        </Switch>
      </Pane>
    </DataPane>
  );
}

function AnswerTable(props: { answer: QueryAnswer; dense: boolean }) {
  const display = useAnswerDisplay();
  const names = display.names(() => props.answer);
  return (
    <QueryResults
      answer={props.answer}
      displayMode="table"
      names={names()}
      display={display}
      compact={props.dense}
    />
  );
}

function ViewTable(props: {
  databaseId: string;
  viewId: string;
  dense: boolean;
}) {
  useDatabaseTableChangedSync(() => props.databaseId);
  const detail = useDatabaseDetailQuery(() => props.databaseId);
  usePending('dynamic_ui.pane.load', () => detail.isPending);
  // A view belongs to one table; a table's own All records view shares its id.
  const shown = () => {
    if (detail.isPending || !detail.isSuccess) return undefined;
    for (const table of detail.data.tables) {
      if (table.table.id === props.viewId)
        return { table, view: allRecordsView(table.table), stored: false };
      const view = table.views.find((entry) => entry.id === props.viewId);
      if (view) return { table, view, stored: true };
    }
    return undefined;
  };
  const unreadable = () =>
    NO_ACCESS_CODES.some((code) =>
      thrownResultErrorHasCode(detail.error, code)
    );
  return (
    <Switch fallback={<PaneLoading dense={props.dense} />}>
      <Match when={detail.isError && unreadable()}>
        <NoAccess dense={props.dense} />
      </Match>
      <Match when={detail.isError}>
        <PaneMessage dense={props.dense}>{t('dynamicUi.failed')}</PaneMessage>
      </Match>
      <Match when={detail.isSuccess && !shown()}>
        <NoAccess dense={props.dense} />
      </Match>
      <Match when={shown()}>
        {(found) => (
          <div
            class={cn(
              'flex flex-none flex-col overflow-hidden',
              props.dense ? 'h-56' : 'h-72'
            )}
          >
            <DatabaseGrid
              host="document"
              schema="cached"
              databaseId={props.databaseId}
              table={found().table}
              canEdit={false}
              view={found().view}
              stored={found().stored}
              onOpenRecord={(rowId) => {
                const opened = openDocument(
                  'database',
                  props.databaseId,
                  {
                    tableId: found().table.table.id,
                    viewId: found().view.id,
                    rowId,
                  },
                  true
                );
                return !!opened && opened.status !== 'unavailable';
              }}
            />
          </div>
        )}
      </Match>
    </Switch>
  );
}
