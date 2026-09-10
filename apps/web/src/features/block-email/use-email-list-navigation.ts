import { adjacentEmail } from '@app/features/email-thread/core/adjacent-email';
import { useMaybeSoup } from '@app/features/next-soup/soup-context';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { getListNavigationSource } from '@app/features/soup/collection/list-navigation-source';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type Accessor, createSignal } from 'solid-js';

/** Keep thread controls tied to the list and filters the user opened it from. */
export function useEmailListNavigation(threadId: Accessor<string>) {
  const panel = useSplitPanel();
  const soup = useMaybeSoup();
  const notificationSource = useGlobalNotificationSource();
  const [navigating, setNavigating] = createSignal(false);
  const source = () => {
    if (!panel) return undefined;
    const id =
      globalSplitManager()?.controllerOf(panel.handle.id) ?? panel.handle.id;
    const list = getListNavigationSource(id);
    return list?.viewId === panel.handle.referredFrom() ? list : undefined;
  };
  const entities = () => {
    const list = source();
    if (list) return list.entities();
    const from = panel?.handle.referredFrom();
    if (from !== 'mail' && from !== 'inbox') return [];
    return soup?.rows().map((row) => row.original) ?? [];
  };
  const target = (direction: -1 | 1) =>
    adjacentEmail(entities(), threadId(), direction);
  const canLoadNext = () =>
    !!source()?.hasMore() &&
    entities().some(
      (entity) => entity.type === 'email' && entity.id === threadId()
    );
  const navigate = async (direction: -1 | 1) => {
    if (!panel || navigating()) return;
    setNavigating(true);
    const currentId = threadId();
    try {
      if (direction === 1 && !target(direction) && canLoadNext())
        await source()?.loadMore();
      if (threadId() !== currentId) return;
      const next = target(direction);
      if (!next) return;
      const row = soup
        ?.rows()
        .find(
          (row) => row.original.type === 'email' && row.original.id === next.id
        );
      if (row) soup?.focus.set(row.id);
      await openEntityInSplitFromUnifiedList(next, {
        splitHandle: panel.handle,
        referredFrom: panel.handle.referredFrom(),
        // Mobile's swipe layout requires ordinary navigation, not mergeHistory.
        mergeHistory: !isTouchDevice(),
        notificationSource,
      });
    } catch {
      toast.failure('Unable to open the next or previous email');
    } finally {
      setNavigating(false);
    }
  };
  return {
    canPrevious: () => !navigating() && !!target(-1),
    canNext: () => !navigating() && (!!target(1) || canLoadNext()),
    previous: () => {
      void navigate(-1);
    },
    next: () => {
      void navigate(1);
    },
  };
}
