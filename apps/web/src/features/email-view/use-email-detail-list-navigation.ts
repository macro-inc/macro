import type {
  EmailThreadCommands,
  EmailThreadListNavigation,
} from '@app/features/email-thread/context/email-thread-context';
import { adjacentEmail } from '@app/features/email-thread/core/adjacent-email';
import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import { useEmailView } from './email-view-context';

/** Keeps thread triage inside the Email view's filtered navigation stack. */
export function useEmailDetailListNavigation(
  threadId: Accessor<string>
): EmailThreadListNavigation {
  const { source, openThread } = useEmailView();
  const [navigating, setNavigating] = createSignal(false);
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const isCurrent = (id: string) => !disposed && threadId() === id;

  const entities = (): EntityData[] =>
    source
      .items()
      .flatMap((row) => (row.kind === 'entity' ? [row.entity] : []));
  const target = (direction: -1 | 1) =>
    adjacentEmail(entities(), threadId(), direction);
  const canLoadNext = () =>
    source.hasMore() &&
    entities().some(
      (entity) => entity.type === 'email' && entity.id === threadId()
    );
  const open = (entity: EntityData) => {
    if (entity.type !== 'email') return;
    openThread({ id: entity.id, fallbackName: entity.name });
  };

  const navigate = async (
    direction: -1 | 1,
    archiveThread?: EmailThreadCommands['archiveThread']
  ) => {
    if (disposed || navigating()) return;
    setNavigating(true);
    const currentId = threadId();
    const current = entities().find(
      (entity) => entity.type === 'email' && entity.id === currentId
    );

    try {
      while (direction === 1 && !target(direction) && canLoadNext()) {
        await source.loadMore();
        if (!isCurrent(currentId)) return;
      }
      if (!isCurrent(currentId)) return;

      const next =
        target(direction) ?? (archiveThread ? target(-1) : undefined);
      if (
        archiveThread &&
        !archiveThread({
          navigate: false,
          nextEntityId: next?.id,
          navigateBack:
            current && next
              ? () => {
                  open(current);
                }
              : undefined,
        })
      ) {
        return;
      }
      if (next) open(next);
    } catch {
      if (isCurrent(currentId)) {
        toast.failure('Unable to open the next or previous email');
      }
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
