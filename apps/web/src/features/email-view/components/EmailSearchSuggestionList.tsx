import { t } from '@app/lib/i18n';
import ClockIcon from '@icon/system/regular/clock.svg';
import FunnelIcon from '@icon/system/regular/funnel-simple.svg';
import { cn } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import {
  type EmailSearchSuggestion,
  type EmailSearchSuggestions,
  SEARCH_SUGGESTIONS_LIST_ID,
  searchSuggestionOptionId,
} from '../search/create-email-search-suggestions';
import {
  emailSearchScopeLabel,
  splitEmailSearchField,
} from '../search/email-search-scope';

/** A remembered search, with the view its `in:` filter named first. */
function RecentSearch(props: { search: string }) {
  const field = () => splitEmailSearchField(props.search);

  return (
    <>
      <ClockIcon aria-hidden="true" class="size-4 shrink-0 text-ink-muted" />
      <Show when={field().scope}>
        {(scope) => (
          <span class="flex h-5 shrink-0 items-center gap-1 rounded-full bg-active px-2 text-xs leading-none">
            <span class="text-ink-muted">{t('emailViews.searchIn')}</span>
            <span class="font-medium text-ink">
              {emailSearchScopeLabel(scope())}
            </span>
          </span>
        )}
      </Show>
      <span class="min-w-0 flex-1 truncate">{field().text}</span>
    </>
  );
}

/** Rows listed above the results while the search field has focus. */
export function EmailSearchSuggestionList(props: {
  suggestions: EmailSearchSuggestions;
  /** Picking with the pointer runs the search and moves to its results. */
  onPick: (index: number) => void;
}) {
  const listsViews = () => props.suggestions.listed()[0]?.kind === 'view';

  return (
    <Show when={props.suggestions.listed().length > 0}>
      <div
        id={SEARCH_SUGGESTIONS_LIST_ID}
        role="listbox"
        aria-label={
          listsViews()
            ? t('emailViews.searchViews')
            : t('emailViews.recentSearches')
        }
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
              </Switch>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
