import { t } from '@app/lib/i18n';
import ClockIcon from '@icon/system/regular/clock.svg';
import { cn } from '@ui';
import { For, Show } from 'solid-js';
import {
  type EmailSearchSuggestions,
  RECENT_SEARCHES_LIST_ID,
  recentSearchOptionId,
} from '../search/create-email-search-suggestions';

/** Recent searches, listed above the results while the search field has focus. */
export function EmailRecentSearches(props: {
  suggestions: EmailSearchSuggestions;
  /** Picking with the pointer runs the search and moves to its results. */
  onPick: (index: number) => void;
}) {
  return (
    <Show when={props.suggestions.listed().length > 0}>
      <div
        id={RECENT_SEARCHES_LIST_ID}
        role="listbox"
        aria-label={t('emailViews.recentSearches')}
        class="flex shrink-0 flex-col border-b border-edge-muted py-1"
      >
        <For each={props.suggestions.listed()}>
          {(query, index) => (
            <div
              id={recentSearchOptionId(index())}
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
              <ClockIcon
                aria-hidden="true"
                class="size-4 shrink-0 text-ink-muted"
              />
              <span class="min-w-0 flex-1 truncate">{query}</span>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
