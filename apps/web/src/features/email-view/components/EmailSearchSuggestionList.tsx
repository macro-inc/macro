import { SearchOperatorText } from '@app/components/view-shell/search-operator-text';
import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import ClockIcon from '@icon/system/regular/clock.svg';
import FunnelIcon from '@icon/system/regular/funnel-simple.svg';
import LabelIcon from '@icon/system/regular/tag.svg';
import TagIcon from '@icon/system/regular/tag-simple.svg';
import { cn } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import {
  type EmailSearchSuggestion,
  type EmailSearchSuggestions,
  SEARCH_SUGGESTIONS_LIST_ID,
  searchSuggestionOptionId,
} from '../search/create-email-search-suggestions';
import {
  type EmailSearchLabel,
  type EmailSearchOperatorCompletion,
  type EmailSearchPerson,
  emailSearchCompletionText,
} from '../search/email-search-operators';
import { emailSearchTextParts } from '../search/email-search-scope';

/** A remembered search, its operators drawn as they are in the field. */
function RecentSearch(props: { search: string }) {
  return (
    <>
      <ClockIcon aria-hidden="true" class="size-4 shrink-0 text-ink-muted" />
      <span class="min-w-0 flex-1 truncate whitespace-pre">
        <SearchOperatorText parts={emailSearchTextParts(props.search)} />
      </span>
    </>
  );
}

type OperatorRow = Extract<
  EmailSearchOperatorCompletion,
  { kind: 'operator' | 'value' }
>;

/**
 * What a filter does that its text does not already say, if anything:
 * `to:` also covers Cc and Bcc, and a date bound or span says how it counts.
 * The minus typed before it shows as `Not:`.
 */
function filterDescription(row: OperatorRow): string | undefined {
  const description =
    row.kind === 'value'
      ? row.value === 'shared'
        ? t('emailViews.searchFilterShared')
        : undefined
      : match(row.key)
          .with('to', () => t('emailViews.searchFilterTo'))
          .with('label', () => t('emailViews.searchFilterLabel'))
          .with('in', () => t('emailViews.searchFilterIn'))
          .with('after', () => t('emailViews.searchFilterAfter'))
          .with('before', () => t('emailViews.searchFilterBefore'))
          .with('newer_than', () => t('emailViews.searchFilterNewerThan'))
          .with('older_than', () => t('emailViews.searchFilterOlderThan'))
          .with('from', 'subject', 'cc', 'bcc', 'is', 'has', () => undefined)
          .exhaustive();
  if (!description) return undefined;
  return row.exclude
    ? t('emailViews.searchFilterNot', { filter: description })
    : description;
}

/** A filter's text, drawn as the field draws an operator. */
function FilterRow(props: { text: string; description?: string }) {
  return (
    <>
      <FunnelIcon aria-hidden="true" class="size-4 shrink-0 text-ink-muted" />
      <span class="min-w-0 flex-1 truncate whitespace-pre">
        <SearchOperatorText parts={[{ text: props.text, operator: true }]} />
      </span>
      <Show when={props.description}>
        {(description) => (
          <span class="min-w-0 shrink truncate text-xs text-ink-extra-muted">
            {description()}
          </span>
        )}
      </Show>
    </>
  );
}

/** Someone to name after `from:` or another person filter. */
function PersonRow(props: { person: EmailSearchPerson }) {
  return (
    <>
      <UserIcon
        id={props.person.id}
        name={props.person.name ?? props.person.email}
        size="sm"
        isDeleted={false}
      />
      <span class="min-w-0 flex-1 truncate">
        {props.person.name ?? props.person.email}
      </span>
      <Show when={props.person.name}>
        <span class="min-w-0 shrink truncate text-xs text-ink-extra-muted">
          {props.person.email}
        </span>
      </Show>
    </>
  );
}

/** A tag or mailbox label to name after `label:` or `in:`. */
function LabelRow(props: { label: EmailSearchLabel }) {
  return (
    <>
      <Show
        when={props.label.kind === 'tag'}
        fallback={
          <LabelIcon
            aria-hidden="true"
            class="size-4 shrink-0 text-ink-muted"
          />
        }
      >
        <TagIcon aria-hidden="true" class="size-4 shrink-0 text-ink-muted" />
      </Show>
      <span class="min-w-0 flex-1 truncate">{props.label.name}</span>
    </>
  );
}

/** The list's name, from what its first row is. */
const listLabel = (first: EmailSearchSuggestion | undefined) =>
  match(first?.kind)
    .with('view', () =>
      first?.kind === 'view' && first.exclude
        ? t('emailViews.searchViewsLeftOut')
        : t('emailViews.searchViews')
    )
    .with('operator', 'value', () => t('emailViews.searchFilters'))
    .with('person', () => t('emailViews.searchPeople'))
    .with('label', () => t('emailViews.searchLabels'))
    .with('recent', undefined, () => t('emailViews.recentSearches'))
    .exhaustive();

/** Rows listed above the results while the search field has focus. */
export function EmailSearchSuggestionList(props: {
  suggestions: EmailSearchSuggestions;
  /** Picking with the pointer runs the search and moves to its results. */
  onPick: (index: number) => void;
}) {
  return (
    <Show when={props.suggestions.listed().length > 0}>
      <div
        id={SEARCH_SUGGESTIONS_LIST_ID}
        role="listbox"
        aria-label={listLabel(props.suggestions.listed()[0])}
        class="flex shrink-0 flex-col border-b border-edge-muted py-1"
      >
        <For each={props.suggestions.listed()}>
          {(suggestion: EmailSearchSuggestion, index) => (
            <div
              id={searchSuggestionOptionId(index())}
              role="option"
              aria-selected={props.suggestions.active() === index()}
              class={cn(
                'flex h-9 min-w-0 items-center gap-2 pr-4 pl-8 text-sm text-ink not-touch:hover:bg-hover touch:h-11 touch:pl-4 touch:text-base',
                props.suggestions.active() === index() && 'bg-hover'
              )}
              // The field keeps focus, so a press is a pick and not a blur.
              // iOS still sends mousedown after a cancelled pointerdown.
              onPointerDown={(event) => event.preventDefault()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => props.onPick(index())}
            >
              <Switch>
                <Match when={suggestion.kind === 'view' && suggestion}>
                  {(view) => (
                    <FilterRow
                      text={`${view().exclude ? '-' : ''}in:${view().scope}`}
                    />
                  )}
                </Match>
                <Match when={suggestion.kind === 'recent' && suggestion}>
                  {(recent) => <RecentSearch search={recent().search} />}
                </Match>
                <Match
                  when={
                    (suggestion.kind === 'operator' ||
                      suggestion.kind === 'value') &&
                    suggestion
                  }
                >
                  {(row) => (
                    <FilterRow
                      text={emailSearchCompletionText(row()).trim()}
                      description={filterDescription(row())}
                    />
                  )}
                </Match>
                <Match when={suggestion.kind === 'person' && suggestion}>
                  {(row) => <PersonRow person={row().person} />}
                </Match>
                <Match when={suggestion.kind === 'label' && suggestion}>
                  {(row) => <LabelRow label={row().label} />}
                </Match>
              </Switch>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
