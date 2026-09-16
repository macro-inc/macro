import { useListDetailNavigation } from '@app/components/list';
import type {
  EmailThreadCommands,
  EmailThreadListNavigation,
} from '@app/features/email-thread/context/email-thread-context';
import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import type { Accessor } from 'solid-js';
import { useEmailView } from './email-view-context';
import type { EmailDataSourceItem } from './queries/use-email-query';

/** Keeps thread triage inside the Email view's filtered navigation stack. */
export function useEmailDetailListNavigation(
  threadId: Accessor<string>
): EmailThreadListNavigation {
  const { source, openThread } = useEmailView();
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
