import { ListHeader } from '@app/components/view-shell/ListHeader';
import { cn } from '@ui';
import { createMemo, createSignal, type JSX, Show } from 'solid-js';
import { ReviewsStatusTabs } from '../components/ReviewsStatusTabs';
import { createReviewsHeaderFit } from '../primitives/create-reviews-header-fit';
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
  const [scope, setScope] = createSignal<HTMLDivElement>();
  // Read from the fit's timer, outside any owner, so it must be a plain read.
  const hasStatus = createMemo(() => props.status !== undefined);
  const fit = createReviewsHeaderFit({
    actions,
    tabs: () => (hasStatus() ? tabs() : undefined),
    scope,
  });

  return (
    <ListHeader
      actionsRef={setActions}
      title={
        <div class="flex min-w-0 items-center gap-3">
          <div
            ref={setScope}
            class={cn('min-w-0', fit.hideScope() && 'hidden')}
          >
            {props.scope}
          </div>
          <Show when={props.status}>
            {(status) => (
              <ReviewsStatusTabs
                ref={setTabs}
                value={status().value}
                onChange={status().onChange}
                iconOnly={fit.iconTabs()}
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
