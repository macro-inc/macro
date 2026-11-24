import { SearchOperatorOverlay } from '@app/components/view-shell/search-operator-text';
import { t } from '@app/lib/i18n';
import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, CommandMenuSearchInput } from '@ui';
import { onCleanup, onMount, Show } from 'solid-js';
import { EmailSearchSuggestionList } from '../../components/EmailSearchSuggestionList';
import type { EmailSearchSuggestions } from '../../search/create-email-search-suggestions';
import { emailSearchTextParts } from '../../search/email-search-scope';

/**
 * The field and Cancel of Email's search page on touch, in place of the list
 * pane's pill row, so on wide touch it stays above the list beside a thread.
 * The list below shows the results as you type.
 */
export function EmailMobileSearchField(props: {
  search: string;
  setSearch: (search: string) => void;
  suggestions: EmailSearchSuggestions;
  /** Clears the search and returns to the mailbox. */
  onCancel: () => void;
  ref: (input: HTMLInputElement) => void;
}) {
  let input: HTMLInputElement | undefined;

  // Escape leaves the page, as Cancel does, from the field and after Search
  // has dropped its focus, since a hardware keyboard can still press it.
  // Android Back arrives as this Escape, so it is marked handled or the app
  // would also go back. A menu or sheet holds focus while open and keeps its
  // own Escape.
  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (isComposing(event) || !input?.isConnected) return;
      if (event.target !== input && event.target !== document.body) return;

      event.preventDefault();
      props.onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  });

  // Keeps the keyboard up for presses on the field's own controls.
  const keepFocus = (event: Event) => event.preventDefault();
  // A hardware keyboard walks the rows under the field and picks one; a
  // picked view or operator keeps the keyboard up for the words, as a tap
  // does.
  const moveInSuggestions = (event: KeyboardEvent) => {
    const suggestions = props.suggestions;
    const active = suggestions.active();
    if (event.key === 'ArrowDown' && active < suggestions.count() - 1) {
      suggestions.setActive(active + 1);
      return true;
    }
    if (event.key === 'ArrowUp' && active >= 0) {
      suggestions.setActive(active - 1);
      return true;
    }
    if (event.key !== 'Enter' || active < 0) return false;

    const editsQuery = suggestions.editsQuery?.(active) ?? false;
    suggestions.pick(active);
    if (!editsQuery) input?.blur();
    return true;
  };

  return (
    <div class="flex w-full min-w-0 items-center gap-2">
      <MobileHeader.Island class="min-w-0 flex-1 gap-2 pr-1">
        <SearchIcon
          aria-hidden="true"
          class="size-4 shrink-0 text-ink-extra-muted"
        />
        {/* Operators (`in:sent`) are drawn as tokens behind the text. */}
        <div class="relative flex min-w-0 flex-1">
          <SearchOperatorOverlay
            parts={emailSearchTextParts(props.search)}
            input={() => input}
            class="text-base text-ink"
          />
          <CommandMenuSearchInput
            ref={(element: HTMLInputElement) => {
              input = element;
              props.ref(element);
            }}
            type="search"
            enterkeyhint="search"
            autocomplete="off"
            aria-label={t('emailViews.searchEmail')}
            aria-controls={props.suggestions.listId}
            aria-activedescendant={props.suggestions.activeId?.()}
            placeholder={t('emailViews.searchAllMail')}
            class="text-base text-transparent caret-ink [&::-webkit-search-cancel-button]:hidden"
            value={props.search}
            onInput={(event) => props.setSearch(event.currentTarget.value)}
            onFocus={() => props.suggestions.setFocused(true)}
            onBlur={() => props.suggestions.setFocused(false)}
            onKeyDown={(event) => {
              if (isComposing(event)) return;
              if (moveInSuggestions(event)) {
                event.preventDefault();
                return;
              }
              // Search drops the keyboard to show the results.
              if (event.key === 'Enter') input?.blur();
            }}
          />
        </div>
        <Show when={props.search}>
          <Button
            aria-label={t('emailViews.clearSearch')}
            variant="ghost"
            size="icon-sm"
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => props.setSearch('')}
          >
            <XIcon class="size-4" />
          </Button>
        </Show>
      </MobileHeader.Island>
      <MobileHeader.Island class="!px-1">
        <Button variant="ghost" size="sm" onClick={props.onCancel}>
          {t('common.cancel')}
        </Button>
      </MobileHeader.Island>
    </div>
  );
}

/**
 * The views an `in:` being typed can name, the operators that finish what is
 * typed, or recent searches, below the search field while it has focus.
 */
export function EmailMobileSearchSuggestions(props: {
  suggestions: EmailSearchSuggestions;
  /** Drops the keyboard to show the picked search's results. */
  onPicked: () => void;
}) {
  return (
    <Show when={props.suggestions.listed().length > 0}>
      <div class="shrink-0 pt-(--mobile-content-inset-top)">
        <EmailSearchSuggestionList
          suggestions={props.suggestions}
          onPick={(index) => {
            const editsQuery = props.suggestions.editsQuery?.(index) ?? false;
            props.suggestions.pick(index);
            // A view or operator picked keeps the keyboard up to type the words.
            if (!editsQuery) props.onPicked();
          }}
        />
      </div>
    </Show>
  );
}

// Safari reports the Enter that commits a composition as not composing; its
// key code still marks it.
function isComposing(event: KeyboardEvent) {
  return event.isComposing || event.keyCode === 229;
}
