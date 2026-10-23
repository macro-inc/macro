import { analytics } from '@app/lib/analytics';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import { type Accessor, createEffect, on, onCleanup, untrack } from 'solid-js';

/** Where a database grid is shown: its own block, a document, or a form's responses. */
export type DatabaseGridHost = 'block' | 'document' | 'form';

/** A filter or sort edit counts once it has been left alone this long. */
const QUERY_SETTLE_MS = 1000;

/**
 * Reports `database_query_run` once when a view opens (including a switch to
 * another view) and once per settled filter or sort change. Refreshes, cache
 * reruns and layout edits reread the same query and are not counted. A change
 * still settling when the view switches or the grid closes is reported then.
 */
export function trackQueryRuns(props: {
  databaseId: string;
  tableId: string;
  host: DatabaseGridHost;
  view: Accessor<DatabaseView>;
}) {
  const track = (view: DatabaseView, trigger: 'open' | 'query_change') =>
    analytics.track('database_query_run', {
      databaseId: props.databaseId,
      tableId: props.tableId,
      viewId: view.id,
      host: props.host,
      trigger,
      filterConditions: view.query.filter?.conditions.length ?? 0,
      sortKeys: view.query.sort?.length ?? 0,
    });

  let settling: DatabaseView | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    if (settling) track(settling, 'query_change');
    settling = undefined;
  };

  createEffect(
    on(
      () => [props.view().id, JSON.stringify(props.view().query)] as const,
      ([viewId], previous) => {
        const view = untrack(props.view);
        if (previous?.[0] !== viewId) {
          flush();
          track(view, 'open');
          return;
        }
        settling = view;
        clearTimeout(timer);
        timer = setTimeout(flush, QUERY_SETTLE_MS);
      }
    )
  );
  onCleanup(flush);
}
