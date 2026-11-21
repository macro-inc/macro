import { useIsAuthenticated } from '@core/auth';
import { fireAndForget } from '@core/util/fireAndForget';
import { useAccessRequestState } from '@queries/access-requests/requests';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
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
  // The item's loader usually read the state for this visit already; the
  // review below decides whether to read it again.
  const query = useAccessRequestState(props.entity, enabled, () => 0, 'caller');
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
  // Cached editors can survive navigation. Decide whether to open from a state
  // read during this visit; a previous visit's pending count may already be resolved.
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
          const readThisVisit =
            query.isSuccess &&
            !query.isFetching &&
            query.dataUpdatedAt >= visit.startedAt();
          const result = readThisVisit
            ? query
            : await query.refetch({ cancelRefetch: false });
          if (cancelled || !result.isSuccess || !visit.claim(key)) return;
          if (result.data.canReview && result.data.pendingCount > 0)
            props.open();
        };
        fireAndForget(review(), 'access-requests');
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
