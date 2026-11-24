import { t } from '@app/lib/i18n';
import { HighlightRender, windowSearchMatch } from '@core/util/searchHighlight';
import RowsIcon from '@icon/system/regular/rows.svg';
import { Show } from 'solid-js';
import type { DatabaseRowMatch } from '../queries/row-search';

/** Characters kept on each side of the snippet's first match. */
const SNIPPET_CONTEXT_CHARS = 40;

export function DatabaseRowIcon(props: { class?: string }) {
  return <RowsIcon class={props.class ?? 'size-4'} />;
}

/** One line: the row's title, its matching passage, and where it lives. */
export function DatabaseRowSearchResult(props: { row: DatabaseRowMatch }) {
  const title = () => props.row.title.trim();
  return (
    <div class="flex min-w-0 flex-1 items-center gap-1.5">
      <span class="min-w-0 max-w-[45%] shrink-0 truncate text-ink">
        <Show when={title()} fallback={t('commandMenu.databaseRowUntitled')}>
          {title()}
        </Show>
      </span>
      <Show when={props.row.snippet}>
        {(snippet) => (
          <span class="min-w-0 flex-1 truncate text-ink-muted">
            <HighlightRender
              text={windowSearchMatch(snippet(), SNIPPET_CONTEXT_CHARS)}
            />
          </span>
        )}
      </Show>
      <span class="ml-auto min-w-0 max-w-[40%] shrink-0 truncate pl-2 text-xs text-ink-muted">
        {t('commandMenu.databaseRowLocation', {
          database: props.row.databaseName,
          table: props.row.tableName,
        })}
      </span>
    </div>
  );
}
