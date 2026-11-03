import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { isEditableInput } from '@core/util/isEditableInput';
import OpenIcon from '@icon/system/regular/arrow-square-out.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import { Button } from '@ui';
import {
  For,
  type JSX,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import type {
  FeedPreferences,
  FeedSource,
} from '../../for-you/context/feed-source';
import type { FeedItem } from '../../for-you/core/feed';
import { FocusActionRow } from '../components/focus-action-row';
import { HomeCalendar } from '../components/home-calendar';
import { createFocusActions } from '../primitives/focus-actions';

/** Home layout with its real composer supplied by the host and live recommendations. */
export function HomeFocusView(props: {
  children?: JSX.Element;
  source: FeedSource;
  preferences: FeedPreferences;
  onOpen: (item: FeedItem) => void;
  onOpenFeed: () => void;
  active?: boolean;
  registerShortcuts?: (handler: (event: KeyboardEvent) => boolean) => void;
}) {
  const state = createFocusActions(props.source, props.preferences);
  let root: HTMLDivElement | undefined;

  onMount(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        props.active === false
      )
        return false;
      const target = event.target;
      if (!(target instanceof Element) || !root) return false;
      if (!root.contains(target) && props.active !== true) return false;
      if (
        isEditableInput(target) ||
        target.closest('[role="dialog"], [role="menu"]')
      )
        return false;
      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault();
        const id = state.move(event.key === 'j' ? 1 : -1);
        const row = root.querySelector(
          `[data-focus-row="${CSS.escape(id ?? '')}"]`
        );
        row?.scrollIntoView({ block: 'nearest' });
        if (row instanceof HTMLElement)
          row.querySelector('button')?.focus({ preventScroll: true });
      } else if (event.key === 'Enter' && target.closest('[data-focus-open]')) {
        const selected = state.selectedId();
        if (!selected) return false;
        event.preventDefault();
        const item = state.actions().find((item) => item.id === selected);
        if (item) props.onOpen(item);
      } else if (event.key === 'e') {
        const selected = state.selectedId();
        if (!selected) return false;
        event.preventDefault();
        state.dismiss(selected);
        root.focus({ preventScroll: true });
      } else {
        return false;
      }
      return true;
    };
    if (props.registerShortcuts) {
      props.registerShortcuts(handleKey);
    } else {
      window.addEventListener('keydown', handleKey);
      onCleanup(() => window.removeEventListener('keydown', handleKey));
    }
  });

  return (
    <div
      ref={root}
      tabIndex={-1}
      class="min-h-0 min-w-0 flex-1 overflow-y-auto outline-none px-6 touch:px-4 touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)"
      aria-label="Home focus"
      data-home-focus
    >
      <div class="mx-auto w-full max-w-180 pt-36 pb-12 mobile:pt-8">
        {props.children}
        <HomeCalendar />
        <section
          class="@container/priorities mt-10"
          aria-label="Suggested next steps"
        >
          <div class="mb-5 flex items-center justify-between gap-4 px-1">
            <div class="flex items-center gap-1">
              <h2 class="text-sm font-medium text-ink">Your top priorities</h2>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Open For you"
                tooltip="Open For you"
                onClick={props.onOpenFeed}
              >
                <OpenIcon class="size-4" />
              </Button>
            </div>
            <span class="hidden shrink-0 text-xs text-ink-extra-muted not-touch:block">
              <kbd>J</kbd> / <kbd>K</kbd> move <span class="mx-2">·</span>
              <kbd>E</kbd> set aside
            </span>
          </div>
          <Switch>
            <Match when={props.source.loading()}>
              <p role="status" class="py-8 text-sm text-ink-muted">
                {t('forYou.loading')}
              </p>
            </Match>
            <Match when={props.source.error()}>
              <div
                role="alert"
                class="flex items-center justify-between gap-4 py-5 text-sm text-ink-muted"
              >
                <span>{t('forYou.loadError')}</span>
                <Show when={props.source.canRetry()}>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={props.source.refreshing()}
                    onClick={() =>
                      fireAndForget(props.source.refresh(), 'home-focus')
                    }
                  >
                    {t('forYou.retry')}
                  </Button>
                </Show>
              </div>
            </Match>
          </Switch>
          <ul class="m-0 list-none space-y-0.5 p-0">
            <For each={state.actions()}>
              {(action) => (
                <FocusActionRow
                  action={action}
                  selected={state.selectedId() === action.id}
                  onSelect={() => state.setSelectedId(action.id)}
                  onOpen={() => {
                    state.setSelectedId(action.id);
                    props.onOpen(action);
                  }}
                  onDismiss={() => state.dismiss(action.id)}
                />
              )}
            </For>
          </ul>
          <Show
            when={
              !props.source.loading() &&
              !props.source.error() &&
              state.actions().length === 0
            }
          >
            <div class="py-14 text-center">
              <CheckIcon class="mx-auto mb-4 size-8 text-ink-muted" />
              <h3 class="text-lg font-medium">A little more breathing room.</h3>
              <p class="mt-2 text-sm text-ink-muted">
                You’ve made it through your next steps.
              </p>
            </div>
          </Show>
          <Show when={state.notice() || state.canUndo()}>
            <div class="mt-6 flex min-h-8 items-center justify-between gap-4 px-1">
              <p role="status" class="text-xs text-ink-muted">
                {state.notice()}
              </p>
              <Show when={state.canUndo()}>
                <Button variant="ghost" size="sm" onClick={state.undo}>
                  Undo last
                </Button>
              </Show>
            </div>
          </Show>
        </section>
      </div>
    </div>
  );
}
