import { SearchOperatorText } from '@app/components/view-shell/search-operator-text';
import type {
  SearchOperatorCompletion,
  SearchOperatorWordFilter,
} from '@app/features/next-soup/core/search-operator-completions';
import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import FunnelIcon from '@icon/system/regular/funnel-simple.svg';
import { cn } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';

/** What the filter a plain word stands for finds. */
const wordFilterLabel = (filter: SearchOperatorWordFilter) =>
  match(filter)
    .with('type:task', () => t('searchOperators.wordTasks'))
    .with('type:email', () => t('searchOperators.wordEmail'))
    .with('type:doc', () => t('searchOperators.wordDocs'))
    .with('is:unread', () => t('searchOperators.wordUnread'))
    .exhaustive();

/** The operator a row puts in the field, to learn it by, as Mail shows it. */
function OperatorHint(props: { text: string }) {
  return (
    <span class="min-w-0 shrink truncate font-mono text-xs text-ink-extra-muted">
      {props.text}
    </span>
  );
}

/** A row for a plain word: what it finds, named, beside the operator. */
function PlainWordRow(
  props: Pick<
    Extract<SearchOperatorCompletion, { kind: 'word' | 'named' }>,
    'insert'
  > & { icon: JSX.Element; label: string }
) {
  return (
    <>
      {props.icon}
      <span class="min-w-0 flex-1 truncate">{props.label}</span>
      <OperatorHint text={props.insert} />
    </>
  );
}

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
  /** In the page's flow, as the phone lists them, not as a menu. */
  inline?: boolean;
}) {
  return (
    <div
      id={props.listId}
      role="listbox"
      aria-label={t('searchOperators.suggestions')}
      class={cn(
        'flex flex-col',
        props.inline
          ? 'w-full'
          : 'menu-surface w-full min-w-64 max-w-md rounded-xl p-1'
      )}
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
            <Switch
              fallback={
                <>
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
                </>
              }
            >
              <Match when={row.kind === 'word' && row}>
                {(word) => (
                  <PlainWordRow
                    insert={word().insert}
                    label={wordFilterLabel(word().filter)}
                    icon={
                      <FunnelIcon
                        aria-hidden="true"
                        class="size-4 shrink-0 text-ink-muted"
                      />
                    }
                  />
                )}
              </Match>
              <Match when={row.kind === 'named' && row}>
                {(named) => {
                  const name = () =>
                    named().person.name ?? named().person.email;
                  return (
                    <PlainWordRow
                      insert={named().insert}
                      label={
                        named().name === 'assignee'
                          ? t('searchOperators.assignedToPerson', {
                              name: name(),
                            })
                          : t('searchOperators.fromPerson', { name: name() })
                      }
                      icon={
                        <span aria-hidden="true" class="flex shrink-0">
                          <UserIcon
                            id={
                              named().person.id ??
                              `macro|${named().person.email}`
                            }
                            name={name()}
                            size="sm"
                            isDeleted={false}
                            suppressClick
                            showTooltip={false}
                          />
                        </span>
                      }
                    />
                  );
                }}
              </Match>
            </Switch>
          </div>
        )}
      </For>
    </div>
  );
}
