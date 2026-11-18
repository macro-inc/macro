import { ListHeader } from '@app/components/view-shell/ListHeader';
import { createLabelCollapse } from '@core/signal/create-label-collapse';
import { cn } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { ReviewsStatusTabs } from '../components/ReviewsStatusTabs';
import type { ReviewsStatusTabId } from '../reviews-types';

/**
 * The desktop Reviews list header. When its actions would run past the
 * header, the status tabs drop to their icons first, then the scope name
 * hides, as Email's does beside its tabs.
 */
export function ReviewsListHeader(props: {
  scope: JSX.Element;
  status?: {
    value: ReviewsStatusTabId | undefined;
    onChange: (value: ReviewsStatusTabId) => void;
  };
  /** Filters, layout, view options, New, then Search. */
  children: JSX.Element;
}) {
  const [actions, setActions] = createSignal<HTMLDivElement>();
  const [tabs, setTabs] = createSignal<HTMLElement>();
  const hasStatus = createMemo(() => props.status !== undefined);
  const collapsed = createLabelCollapse(
    actions,
    () => (hasStatus() ? ['tabs', 'scope'] : ['scope']),
    { watchContent: true }
  );
  const iconTabs = () => collapsed('tabs');
  keepStatusFocus(tabs, iconTabs);

  return (
    <ListHeader
      actionsRef={setActions}
      title={
        <div class="flex min-w-0 items-center gap-3">
          <div class={cn('min-w-0', collapsed('scope') && 'hidden')}>
            {props.scope}
          </div>
          <Show when={props.status}>
            {(status) => (
              <ReviewsStatusTabs
                ref={setTabs}
                value={status().value}
                onChange={status().onChange}
                iconOnly={iconTabs()}
                class="shrink-0"
              />
            )}
          </Show>
        </div>
      }
    >
      {props.children}
    </ListHeader>
  );
}

/**
 * Tabs render their options anew when they switch to icons, which would drop
 * a keyboard user's focus on a status; it moves to the same status instead.
 */
function keepStatusFocus(
  tabs: Accessor<HTMLElement | undefined>,
  iconOnly: Accessor<boolean>
) {
  let focused: string | undefined;
  createEffect(
    on(tabs, (element) => {
      if (!element) return;
      const remember = (event: FocusEvent) => {
        if (event.target instanceof HTMLInputElement)
          focused = event.target.value;
      };
      // An option removed with focus still in it is not the user leaving;
      // by the next microtask it is detached, while one the user left is not.
      const forget = (event: FocusEvent) => {
        const option = event.target;
        queueMicrotask(() => {
          if (!(option instanceof Node) || !option.isConnected) return;
          if (!element.contains(document.activeElement)) focused = undefined;
        });
      };
      element.addEventListener('focusin', remember);
      element.addEventListener('focusout', forget);
      onCleanup(() => {
        element.removeEventListener('focusin', remember);
        element.removeEventListener('focusout', forget);
      });
    })
  );
  createEffect(
    on(
      iconOnly,
      () => {
        const element = tabs();
        if (!element || focused === undefined) return;
        if (element.contains(document.activeElement)) return;
        element
          .querySelector<HTMLInputElement>(
            `input[value="${CSS.escape(focused)}"]`
          )
          ?.focus();
      },
      { defer: true }
    )
  );
}
