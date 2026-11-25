import { SearchOperatorText } from '@app/components/view-shell/search-operator-text';
import type { SearchOperatorCompletion } from '@app/features/next-soup/core/search-operator-completions';
import { t } from '@app/lib/i18n';
import { cn } from '@ui';
import { For, Show } from 'solid-js';
import { match } from 'ts-pattern';

/** What a row adds to the operator it writes, when that says something new. */
function rowDetail(row: SearchOperatorCompletion): string | undefined {
  return match(row)
    .with({ kind: 'name' }, ({ name }) =>
      match(name)
        .with('type', () => t('searchOperators.type'))
        .with('from', () => t('searchOperators.from'))
        .with('assignee', () => t('searchOperators.assignee'))
        .with('author', () => t('searchOperators.author'))
        .with('status', () => t('searchOperators.status'))
        .with('priority', () => t('searchOperators.priority'))
        .with('inbox', () => t('searchOperators.inbox'))
        .with('in', () => t('searchOperators.in'))
        .with('tag', () => undefined)
        .exhaustive()
    )
    .with({ kind: 'person' }, ({ person }) =>
      person === 'me' ? t('searchOperators.you') : person.name
    )
    .otherwise(() => undefined);
}

/**
 * The operators and values the Search field offers for what is typed at its
 * end, each drawn as the field draws the operator it writes.
 */
export function SearchOperatorSuggestions(props: {
  rows: readonly SearchOperatorCompletion[];
  active: number;
  listId: string;
  onPick: (index: number) => void;
}) {
  return (
    <div
      id={props.listId}
      role="listbox"
      aria-label={t('searchOperators.suggestions')}
      class="menu-surface absolute top-full left-0 z-item-options-menu mt-1 flex w-full min-w-64 max-w-md flex-col rounded-xl p-1"
    >
      <For each={props.rows}>
        {(row, index) => (
          <div
            id={`${props.listId}-${index()}`}
            role="option"
            aria-selected={props.active === index()}
            class={cn(
              'flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-sm text-ink not-touch:hover:bg-hover touch:h-11',
              props.active === index() && 'bg-hover'
            )}
            // The field keeps focus, so a press picks rather than blurs.
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => props.onPick(index())}
          >
            <span class="min-w-0 flex-1 truncate whitespace-pre">
              <SearchOperatorText
                parts={[{ text: row.insert, operator: true }]}
              />
            </span>
            <Show when={rowDetail(row)}>
              {(detail) => (
                <span class="min-w-0 shrink truncate text-xs text-ink-extra-muted">
                  {detail()}
                </span>
              )}
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}
