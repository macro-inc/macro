import { isEditableInput } from '@core/util/isEditableInput';
import CheckIcon from '@icon/system/regular/check.svg';
import { Button } from '@ui';
import { For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { FocusActionDialog } from '../components/focus-action-dialog';
import { FocusActionRow } from '../components/focus-action-row';
import { HomeCalendar } from '../components/home-calendar';
import { FOCUS_ACTIONS } from '../core/focus-actions';
import { createFocusActions } from '../primitives/focus-actions';

/** Home layout with its real composer supplied by the host and local sample rows. */
export function HomeFocusView(props: {
  children?: JSX.Element;
  active?: boolean;
  registerShortcuts?: (handler: (event: KeyboardEvent) => boolean) => void;
}) {
  const state = createFocusActions(FOCUS_ACTIONS);
  let root: HTMLDivElement | undefined;

  onMount(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        props.active === false ||
        state.opened()
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
        const row = root.querySelector(`[data-focus-row="${id}"]`);
        row?.scrollIntoView({ block: 'nearest' });
        if (row instanceof HTMLElement)
          row.querySelector('button')?.focus({ preventScroll: true });
      } else if (event.key === 'Enter' && target.closest('[data-focus-open]')) {
        const selected = state.selectedId();
        if (!selected) return false;
        event.preventDefault();
        state.setOpenedId(selected);
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
      <div class="mx-auto w-full max-w-180 pt-12 pb-12 mobile:pt-8">
        {props.children}
        <HomeCalendar />
        <section
          class="@container/priorities mt-10"
          aria-label="Suggested next steps"
        >
          <div class="mb-5 flex items-center justify-between gap-4 px-1">
            <h2 class="text-sm font-medium text-ink">Your top priorities</h2>
            <span class="hidden shrink-0 text-xs text-ink-extra-muted not-touch:block">
              <kbd>J</kbd> / <kbd>K</kbd> move <span class="mx-2">·</span>
              <kbd>E</kbd> set aside
            </span>
          </div>
          <ul class="m-0 list-none space-y-0.5 p-0">
            <For each={state.actions()}>
              {(action) => (
                <FocusActionRow
                  action={action}
                  selected={state.selectedId() === action.id}
                  onSelect={() => state.setSelectedId(action.id)}
                  onOpen={() => {
                    state.setSelectedId(action.id);
                    state.setOpenedId(action.id);
                  }}
                  onDismiss={() => state.dismiss(action.id)}
                />
              )}
            </For>
          </ul>
          <Show when={state.actions().length === 0}>
            <div class="py-14 text-center">
              <CheckIcon class="mx-auto mb-4 size-8 text-ink-muted" />
              <h3 class="text-lg font-medium">A little more breathing room.</h3>
              <p class="mt-2 text-sm text-ink-muted">
                You’ve made it through your next steps.
              </p>
            </div>
          </Show>
          <div class="mt-6 flex min-h-8 items-center justify-between gap-4 px-1">
            <p role="status" class="text-xs text-ink-muted">
              {state.notice() ||
                'Just the things that could use your attention.'}
            </p>
            <Show when={state.dismissedCount() > 0}>
              <Button variant="ghost" size="sm" onClick={state.undo}>
                Undo last
              </Button>
            </Show>
          </div>
        </section>
      </div>
      <Show when={state.opened()} keyed>
        {(action) => (
          <FocusActionDialog
            action={action}
            draft={state.draft(action)}
            onDraftChange={(value) => state.updateDraft(action.id, value)}
            onClose={() => state.setOpenedId(undefined)}
            onComplete={() =>
              state.dismiss(
                action.id,
                'Done for now. One less thing on your mind.'
              )
            }
          />
        )}
      </Show>
    </div>
  );
}
