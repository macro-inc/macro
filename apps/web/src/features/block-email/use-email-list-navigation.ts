import type {
  EmailThreadCommands,
  EmailThreadListNavigation,
} from '@app/features/email-thread/context/email-thread-context';
import { adjacentEmail } from '@app/features/email-thread/core/adjacent-email';
import { useMaybeSoup } from '@app/features/next-soup/soup-context';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { getListNavigationSource } from '@app/features/soup/collection/list-navigation-source';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { EntityData } from '@entity';
import { type Accessor, createSignal } from 'solid-js';

/** Keep thread controls tied to the list and filters the user opened it from. */
export function useEmailListNavigation(
  threadId: Accessor<string>
): EmailThreadListNavigation {
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
  const open = async (
    entity: EntityData,
    referredFrom = panel?.handle.referredFrom()
  ) => {
    if (!panel) return;
    const row = soup
      ?.rows()
      .find(
        (row) => row.original.type === 'email' && row.original.id === entity.id
      );
    if (row) soup?.focus.set(row.id);
    try {
      await openEntityInSplitFromUnifiedList(entity, {
        splitHandle: panel.handle,
        referredFrom,
        // Mobile's swipe layout requires ordinary navigation, not mergeHistory.
        mergeHistory: !isTouchDevice(),
        notificationSource,
      });
    } catch {
      toast.failure('Unable to open the next or previous email');
    }
  };
  const navigate = async (
    direction: -1 | 1,
    archiveThread?: EmailThreadCommands['archiveThread']
  ) => {
    if (!panel || navigating()) return;
    setNavigating(true);
    const currentId = threadId();
    const current = entities().find(
      (entity) => entity.type === 'email' && entity.id === currentId
    );
    const referredFrom = panel.handle.referredFrom();
    try {
      if (direction === 1 && !target(direction) && canLoadNext())
        await source()?.loadMore();
      if (threadId() !== currentId) return;
      // Capture the destination before archiving removes the current list row.
      // At the end of the list, triage falls back to the previous email.
      const next =
        target(direction) ?? (archiveThread ? target(-1) : undefined);
      if (
        archiveThread &&
        !archiveThread({
          navigate: false,
          navigateBack:
            current && next
              ? () => void open(current, referredFrom)
              : undefined,
        })
      )
        return;
      if (!next) return;
      await open(next, referredFrom);
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
    markDone: (archiveThread) => {
      void navigate(1, archiveThread);
    },
  };
}
