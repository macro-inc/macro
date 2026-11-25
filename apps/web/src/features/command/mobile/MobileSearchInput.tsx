import {
  SearchOperatorOverlay,
  type SearchTextPart,
} from '@app/components/view-shell/search-operator-text';
import { searchOperatorSpans } from '@app/features/next-soup/core/search-operators';
import { t } from '@app/lib/i18n';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import {
  useForegroundMobileView,
  useMobileNavNavigate,
} from '@components/app/mobile/use-mobile-nav';
import { usePreserveFocusOnButtonTaps } from '@core/mobile/usePreserveFocusOnButtonTaps';
import { followKeyboardViewport } from '@core/mobile/viewport-insets';
import { lazyNamed } from '@core/util/lazyNamed';
import XIcon from '@icon/system/regular/x.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { CommandMenuSearchInput } from '@ui';
import { createEffect, createSignal, on, Show, Suspense } from 'solid-js';
import { useUniversalInputEnabled } from '../../universal-input/use-universal-input';
import { SearchState } from './mobileSearchState';

/** The field's text with the operators the search reads marked, to draw. */
function operatorParts(text: string): SearchTextPart[] {
  const parts: SearchTextPart[] = [];
  let at = 0;
  for (const { start, end } of searchOperatorSpans(text)) {
    if (start > at)
      parts.push({ text: text.slice(at, start), operator: false });
    parts.push({ text: text.slice(start, end), operator: true });
    at = end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), operator: false });
  return parts;
}

const MobileUniversalInput = lazyNamed(
  () => import('../../universal-input/universal-input'),
  'MobileUniversalInput'
);

// The input lives in app chrome, outside result/category boundaries, and stays
// mounted throughout the session so switching categories preserves the keyboard.
export function MobileSearchInput() {
  const [container, setContainer] = createSignal<HTMLDivElement>();
  const inputSize = createElementSize(container);
  let inputRef: HTMLTextAreaElement | undefined;
  const universalInputEnabled = useUniversalInputEnabled();
  const [sending, setSending] = createSignal(false);
  // The text as shown, a word being composed included, which the search
  // only takes once it commits.
  const [shown, setShown] = createSignal(SearchState.query());
  createEffect(on(SearchState.query, setShown));

  const foregroundView = useForegroundMobileView();
  const navigate = useMobileNavNavigate();

  // iOS ends the editing session (dropping the keyboard) while processing
  // button taps even when pointerdown is cancelled. This keeps the input
  // focused for taps on its own buttons and on [data-keep-keyboard] regions —
  // notably the category pills, so switching categories keeps the keyboard up.
  usePreserveFocusOnButtonTaps(container);

  // The X explicitly ends search: close() resets
  // the query and unmounts the search row with its input (dropping the
  // keyboard). The Search view only exists for searching, so exiting from it
  // returns to the default view.
  const handleClear = () => {
    if (universalInputEnabled() && SearchState.session().universalInputActive())
      SearchState.session().setQuery('');
    SearchState.close();
    if (foregroundView() === 'search') navigate('home');
  };

  return (
    <>
      <Show
        when={
          universalInputEnabled() &&
          SearchState.session().universalInputActive() &&
          SearchState.session()
        }
        keyed
      >
        {(session) => (
          <Suspense>
            <MobileUniversalInput
              text={session.query()}
              editor={null}
              onTextChange={session.setQuery}
              onSendingChange={setSending}
              onComplete={() => {
                session.setQuery('');
                if (SearchState.isOpen()) inputRef?.focus();
              }}
              onNavigate={() => {
                session.setQuery('');
                SearchState.close();
              }}
              layout={(parts) => (
                <FloatRegion region="accessory" priority={101}>
                  <div
                    ref={followKeyboardViewport}
                    data-keep-keyboard
                    aria-label="Suggested action"
                    class="pointer-events-auto px-(--mobile-chrome-gutter)"
                    style={{
                      '--universal-input-max-height': `max(0px, calc(var(--dvh, 1dvh) * 100 - var(--mobile-content-inset-top, 0px) - ${inputSize.height ?? 44}px - var(--mobile-chrome-gutter) * 3 - var(--safe-bottom, 0px)))`,
                      '--universal-input-body-overflow': 'auto',
                    }}
                  >
                    {parts.fields}
                    {parts.result}
                  </div>
                </FloatRegion>
              )}
            />
          </Suspense>
        )}
      </Show>
      <div
        ref={setContainer}
        class="island pointer-events-auto flex min-h-11 min-w-0 flex-1 items-end gap-1 rounded-[22px] py-1 pr-1 pl-4"
      >
        {/* Operators (`type:task`) are drawn as tokens behind the text. */}
        <div class="relative flex min-w-0 flex-1">
          <SearchOperatorOverlay
            multiline
            parts={operatorParts(shown())}
            input={() => inputRef}
            class="py-1.5 text-base text-ink"
          />
          <CommandMenuSearchInput
            as="textarea"
            ref={inputRef}
            id="mobile-search-input"
            aria-label={
              universalInputEnabled()
                ? t('commandMenu.mobileSearchOrCreate')
                : t('commandMenu.hintSearch')
            }
            readOnly={sending()}
            aria-busy={sending()}
            enterkeyhint="enter"
            class="min-h-9 max-h-32 py-1.5 text-base text-transparent caret-ink"
            placeholder={t('commandMenu.mobileSearchPlaceholder')}
            value={SearchState.query()}
            // Blurring never ends the session — the keyboard drops but search
            // mode stays until the X is pressed or navigation covers this entry.
            onInput={(e) => {
              setShown(e.currentTarget.value);
              if (!e.isComposing) SearchState.setQuery(e.currentTarget.value);
            }}
            onCompositionEnd={(e) =>
              SearchState.setQuery(e.currentTarget.value)
            }
          />
        </div>
        {/* The input only mounts while a session is open, so the X is always
          available as the exit. */}
        <button
          type="button"
          class="flex size-9 shrink-0 items-center justify-center rounded-full text-ink-muted"
          aria-label={t('commandMenu.closeSearch')}
          onPointerDown={(e) => {
            e.preventDefault();
          }}
          onClick={handleClear}
        >
          <XIcon class="size-4" />
        </button>
      </div>
    </>
  );
}
