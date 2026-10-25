import {
  type ListDetailNavigation,
  useListDetailNavigation,
} from '@app/components/list';
import type {
  EmailThreadCommands,
  EmailThreadListNavigation,
} from '@app/features/email-thread/context/email-thread-context';
import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import type { Accessor } from 'solid-js';
import { useEmailView } from './email-view-context';
import type { EmailDataSourceItem } from './queries/use-email-query';
import { useEmailReaderPane } from './reader-pane';

/** Keeps thread triage inside the Email view's filtered navigation stack. */
export function useEmailDetailListNavigation(
  threadId: Accessor<string>
): EmailThreadListNavigation &
  Pick<ListDetailNavigation<EntityData>, 'navigate'> {
  const { source, openThread, list } = useEmailView();
  // Beside the list, the reader steps like the list cursor: the cursor moves
  // with it and each step replaces history instead of adding an entry.
  const inPane = useEmailReaderPane() !== undefined;
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
      const thread = { id: entity.id, fallbackName: entity.name };
      if (!inPane) {
        openThread(thread);
        return;
      }
      const row = source
        .items()
        .find((item) => item.kind === 'entity' && item.entity.id === entity.id);
      if (row) list.focus.set(row.id, { reason: 'programmatic' });
      openThread(thread, { replace: true });
    },
    onError: () => toast.failure('Unable to open the next or previous email'),
  });

  return {
    ...navigation,
    // A saved reminder hides the thread; navigation follows its old position.
    afterReminderSaved: () => navigation.navigate(1, { fallbackDirection: -1 }),
    markDone: async (
      archiveThread: EmailThreadCommands['archiveThread'],
      requested?: string
    ) => {
      if (requested !== undefined && requested !== threadId()) return false;
      let archived = false;
      await navigation.navigate(1, {
        fallbackDirection: -1,
        beforeOpen: (next, current) => {
          archived = archiveThread({
            navigate: false,
            nextEntityId: next?.id,
            navigateBack:
              current && next
                ? () => {
                    navigation.open(current);
                  }
                : undefined,
          });
          return archived;
        },
      });
      return archived;
    },
  };
}
