import type {
  EmailThreadCommands,
  EmailThreadListNavigation,
} from '@app/features/email-thread/context/email-thread-context';
import { adjacentEmail } from '@app/features/email-thread/core/adjacent-email';
import { useMaybeSoup } from '@app/features/next-soup/soup-context';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import {
  getListNavigationSource,
  listNavigationSourceId,
} from '@app/features/soup/collection/list-navigation-source';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import { type Accessor, createSignal, onCleanup } from 'solid-js';

/** Keep thread controls tied to the list and filters the user opened it from. */
export function useEmailListNavigation(
  threadId: Accessor<string>
): EmailThreadListNavigation {
  const panel = useSplitPanel();
  const soup = useMaybeSoup();
  const notificationSource = useGlobalNotificationSource();
  const [navigating, setNavigating] = createSignal(false);
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const source = () => {
    if (!panel) return undefined;
    const manager = globalSplitManager();
    const controllerId = manager?.controllerOf(panel.handle.id);
    const handle =
      (controllerId && manager?.getSplit(controllerId)) || panel.handle;
    const list = getListNavigationSource(listNavigationSourceId(handle));
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
        // Step within the current detail slot, preserving the list behind it.
        mergeHistory: true,
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
    if (!panel || disposed || navigating()) return;
    setNavigating(true);
    const currentId = threadId();
    const current = entities().find(
      (entity) => entity.type === 'email' && entity.id === currentId
    );
    const referredFrom = panel.handle.referredFrom();
    const list = source();
    const wasActive = panel.isPanelActive();
    const isCurrent = () =>
      !disposed &&
      threadId() === currentId &&
      panel.handle.content().id === currentId &&
      (!wasActive || panel.isPanelActive()) &&
      source() === list;
    try {
      while (direction === 1 && !target(direction) && canLoadNext()) {
        await list?.loadMore();
        if (!isCurrent()) return;
      }
      if (!isCurrent()) return;
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
      if (isCurrent())
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
