import type {
  EmailThreadCommands,
  EmailThreadListNavigation,
} from '@app/features/email-thread/context/email-thread-context';
import {
  adjacentEmail,
  type EmailPosition,
  emailPosition,
} from '@app/features/email-thread/core/adjacent-email';
import { useMaybeSoup } from '@app/features/next-soup/soup-context';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import {
  getListNavigationSource,
  listNavigationSourceId,
} from '@app/features/soup/collection/list-navigation-source';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EntityData } from '@entity';
import { type Accessor, createMemo, createSignal, onCleanup } from 'solid-js';

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
    const handle = panel.handle;
    const list = getListNavigationSource(listNavigationSourceId(handle));
    return list?.viewId === panel.handle.referredFrom() ? list : undefined;
  };
  const entities = () => {
    const list = source();
    if (list) return list.entities();
    const from = panel?.handle.referredFrom();
    if (from !== 'mail' && from !== 'home') return [];
    return soup?.rows().map((row) => row.original) ?? [];
  };
  // Where the open thread sat when it was opened: next and previous keep
  // stepping from there after it moves or leaves the list.
  const position = createMemo<EmailPosition | undefined>((previous) =>
    previous?.id === threadId()
      ? previous
      : emailPosition(entities(), threadId())
  );
  const target = (direction: -1 | 1) =>
    adjacentEmail(entities(), threadId(), direction, position());
  // More pages place a thread that left the list only after a surviving
  // earlier neighbour (their first row follows it). With none, paging could
  // never find a next email, so it would load the whole mailbox.
  const canLoadNext = () => {
    const at = position();
    if (!source()?.hasMore() || at?.id !== threadId()) return false;
    const listed = new Set(entities().map((entity) => entity.id));
    return listed.has(at.id) || at.previous.some((id) => listed.has(id));
  };
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
  /** Resolves whether it archived the thread through `archiveThread`. */
  const navigate = async (
    direction: -1 | 1,
    archiveThread?: EmailThreadCommands['archiveThread']
  ): Promise<boolean> => {
    if (!panel || disposed || navigating()) return false;
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
        if (!isCurrent()) return false;
      }
      if (!isCurrent()) return false;
      // Capture the destination before archiving removes the current list row.
      // At the end of the list, triage falls back to the previous email.
      const next =
        target(direction) ?? (archiveThread ? target(-1) : undefined);
      const archived =
        !!archiveThread &&
        archiveThread({
          navigate: false,
          navigateBack:
            current && next
              ? () =>
                  fireAndForget(open(current, referredFrom), 'email-navigation')
              : undefined,
        });
      if (archiveThread && !archived) return false;
      if (next) await open(next, referredFrom);
      return archived;
    } catch {
      if (isCurrent())
        toast.failure('Unable to open the next or previous email');
      return false;
    } finally {
      setNavigating(false);
    }
  };
  return {
    canPrevious: () => !navigating() && !!target(-1),
    canNext: () => !navigating() && (!!target(1) || canLoadNext()),
    previous: () => {
      fireAndForget(navigate(-1), 'email-navigation');
    },
    next: () => {
      fireAndForget(navigate(1), 'email-navigation');
    },
    markDone: async (archiveThread, requested) => {
      if (requested !== undefined && requested !== threadId()) return false;
      return navigate(1, archiveThread);
    },
  };
}
