import { SearchOperatorText } from '@app/components/view-shell/search-operator-text';
import { t } from '@app/lib/i18n';
import ClockIcon from '@icon/system/regular/clock.svg';
import FunnelIcon from '@icon/system/regular/funnel-simple.svg';
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
  type EmailSearchOperatorCompletion,
  emailSearchCompletionText,
} from '../search/email-search-operators';
import {
  emailSearchScopeLabel,
  emailSearchTextParts,
} from '../search/email-search-scope';

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

/** What an operator's name or value finds, as its row names it. */
function completionLabel(completion: EmailSearchOperatorCompletion): string {
  if (completion.kind === 'value') {
    return match(completion.value)
      .with('unread', () => t('emailViews.searchFilterUnread'))
      .with('read', () => t('emailViews.searchFilterRead'))
      .with('starred', () => t('emailViews.searchFilterStarred'))
      .with('shared', () => t('emailViews.searchFilterShared'))
      .with('attachment', () => t('emailViews.searchFilterAttachment'))
      .exhaustive();
  }
  return match(completion.key)
    .with('from', () => t('emailViews.searchFilterFrom'))
    .with('to', () => t('emailViews.searchFilterTo'))
    .with('subject', () => t('emailViews.searchFilterSubject'))
    .with('cc', () => t('emailViews.searchFilterCc'))
    .with('bcc', () => t('emailViews.searchFilterBcc'))
    .with('label', () => t('emailViews.searchFilterLabel'))
    .with('in', () => t('emailViews.searchFilterIn'))
    .with('is', () => t('emailViews.searchFilterIs'))
    .with('has', () => t('emailViews.searchFilterHas'))
    .with('after', () => t('emailViews.searchFilterAfter'))
    .with('before', () => t('emailViews.searchFilterBefore'))
    .with('newer_than', () => t('emailViews.searchFilterNewerThan'))
    .with('older_than', () => t('emailViews.searchFilterOlderThan'))
    .exhaustive();
}

/** A row that finishes the operator being typed. */
function OperatorCompletion(props: {
  completion: EmailSearchOperatorCompletion;
}) {
  return (
    <>
      <FunnelIcon aria-hidden="true" class="size-4 shrink-0 text-ink-muted" />
      <span class="min-w-0 flex-1 truncate">
        {completionLabel(props.completion)}
      </span>
      <span class="shrink-0 font-mono text-xs text-ink-extra-muted">
        {emailSearchCompletionText(props.completion).trim()}
      </span>
    </>
  );
}

/** The list's name, from what its first row is. */
const listLabel = (first: EmailSearchSuggestion | undefined) =>
  match(first?.kind)
    .with('view', () => t('emailViews.searchViews'))
    .with('operator', 'value', () => t('emailViews.searchFilters'))
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
                    <>
                      <FunnelIcon
                        aria-hidden="true"
                        class="size-4 shrink-0 text-ink-muted"
                      />
                      <span class="min-w-0 flex-1 truncate">
                        {emailSearchScopeLabel(view().scope)}
                      </span>
                      <span class="shrink-0 font-mono text-xs text-ink-extra-muted">
                        in:{view().scope}
                      </span>
                    </>
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
                  {(completion) => (
                    <OperatorCompletion completion={completion()} />
                  )}
                </Match>
              </Switch>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
