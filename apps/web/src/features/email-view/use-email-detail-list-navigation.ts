import { useListDetailNavigation } from '@app/components/list';
import type {
  EmailThreadCommands,
  EmailThreadListNavigation,
} from '@app/features/email-thread/context/email-thread-context';
import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import { type Accessor, createMemo, onCleanup } from 'solid-js';
import { useEmailView } from './email-view-context';
import type { EmailDataSourceItem } from './queries/use-email-query';

/** Keeps thread triage inside the Email view's filtered navigation stack. */
export function useEmailDetailListNavigation(
  threadId: Accessor<string>
): EmailThreadListNavigation {
  const { source, openThread } = useEmailView();
  const emails = () =>
    source
      .items()
      .flatMap((row) =>
        row.kind === 'entity' && row.entity.type === 'email' ? [row.entity] : []
      );
  // Label events can remove the saved thread before its HTTP response arrives.
  // Retain its last position, but only navigate to candidates still in this view.
  const reminderAnchor = createMemo<
    | {
        threadId: string;
        next: string[];
        previous: string[];
      }
    | undefined
  >((previous) => {
    const id = threadId();
    const rows = emails();
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) return previous?.threadId === id ? previous : undefined;
    return {
      threadId: id,
      next: rows.slice(index + 1).map((row) => row.id),
      previous: rows
        .slice(0, index)
        .reverse()
        .map((row) => row.id),
    };
  });
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const navigation = useListDetailNavigation<EmailDataSourceItem, EntityData>({
    currentId: threadId,
    source,
    getEntity: (row) => {
      if (row.kind !== 'entity' || row.entity.type !== 'email') return;
      return row.entity;
    },
    getContinuation: (row) =>
      row.kind === 'load-more' ? source.loadMore : undefined,
    open: (entity) => {
      if (entity.type !== 'email') return;
      openThread({ id: entity.id, fallbackName: entity.name });
    },
    onError: () => toast.failure('Unable to open the next or previous email'),
  });

  return {
    ...navigation,
    afterReminderSaved: async () => {
      const id = threadId();
      if (emails().some((row) => row.id === id)) {
        await navigation.navigate(1, { fallbackDirection: -1 });
        return;
      }
      const anchor = reminderAnchor();
      if (!anchor || disposed) return;
      const surviving = (ids: string[]) => {
        const live = new Map(emails().map((row) => [row.id, row]));
        return ids.map((candidate) => live.get(candidate)).find(Boolean);
      };
      try {
        let next = surviving(anchor.next);
        while (!next && source.hasMore() && !disposed && threadId() === id) {
          const before = new Set(emails().map((row) => row.id));
          await source.loadMore();
          if (source.error()) throw source.error();
          next =
            surviving(anchor.next) ??
            emails().find((row) => !before.has(row.id));
        }
        if (disposed || threadId() !== id) return;
        const target = next ?? surviving(anchor.previous);
        if (target) navigation.open(target);
      } catch {
        if (!disposed && threadId() === id)
          toast.failure('Unable to open the next or previous email');
      }
    },
    markDone: (archiveThread: EmailThreadCommands['archiveThread']) => {
      void navigation.navigate(1, {
        fallbackDirection: -1,
        beforeOpen: (next, current) =>
          archiveThread({
            navigate: false,
            nextEntityId: next?.id,
            navigateBack:
              current && next
                ? () => {
                    navigation.open(current);
                  }
                : undefined,
          }),
      });
    },
  };
}
