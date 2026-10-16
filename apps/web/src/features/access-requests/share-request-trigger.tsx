import { useIsAuthenticated } from '@core/auth';
import { useAccessRequestState } from '@queries/access-requests/requests';

import {
  type Accessor,
  createEffect,
  createSignal,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { useAccessRequestVisit } from './context/visit';
import type { ShareEntity } from './core/types';

/** Adapter for an existing Share trigger; all host lifecycle is supplied explicitly. */
export function useShareRequestTrigger(props: {
  entity: Accessor<ShareEntity | undefined>;
  active: Accessor<boolean>;
  open: () => void;
}) {
  const authenticated = useIsAuthenticated();
  const visit = useAccessRequestVisit();
  const [element, setElement] = createSignal<HTMLElement>();
  const [visible, setVisible] = createSignal(false);
  const enabled = () => !!authenticated() && visible();
  const query = useAccessRequestState(props.entity, enabled);
  const entityKey = () => {
    const entity = props.entity();
    return entity ? `${entity.entityType}:${entity.entityId}` : '';
  };
  onMount(() => {
    const node = element();
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting)
    );
    observer.observe(node);
    onCleanup(() => observer.disconnect());
  });
  // Cached editors can survive navigation. Fetch for this visit before deciding
  // whether to open; a previous visit's pending count may already be resolved.
  createEffect(
    on(
      () => [enabled() && props.active(), entityKey(), visit?.key()] as const,
      ([ready, key]) => {
        if (!ready || !key || !visit) return;
        let cancelled = false;
        onCleanup(() => {
          cancelled = true;
        });
        const review = async () => {
          const result = await query.refetch({ cancelRefetch: false });
          if (cancelled || !result.isSuccess || !visit.claim(key)) return;
          if (result.data.canReview && result.data.pendingCount > 0)
            props.open();
        };
        void review();
      }
    )
  );

  return {
    ref: setElement,
    count: () =>
      !query.isPending && query.data?.canReview ? query.data.pendingCount : 0,
    open() {
      visit?.claim(entityKey());
      props.open();
    },
  };
}

export function ShareRequestIcon(props: {
  count: number;
  children: JSX.Element;
}) {
  return (
    <span class="relative inline-flex">
      {props.children}
      <Show when={props.count > 0}>
        <span
          aria-label={`${props.count} pending permission requests`}
          class="absolute -top-2 -right-2 min-w-3.5 rounded-full bg-accent px-0.5 text-center text-[9px] leading-3.5 text-page"
        >
          {props.count > 99 ? '99+' : props.count}
        </span>
      </Show>
    </span>
  );
}
