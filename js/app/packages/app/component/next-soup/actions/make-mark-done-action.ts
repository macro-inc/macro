import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import { toast } from '@core/component/Toast/Toast';
import { type EntityData, isTaskEntity } from '@entity';
import type { NotificationSource } from '@notifications';
import type { SoupState } from '../create-soup-state';
import { markEntitiesDone } from '@app/component/next-soup/utils';

type MakeMarkDoneOptions = {
  userId?: () => string | undefined;
  notificationSource: () => NotificationSource;
};

export const makeMarkDoneAction = (options: MakeMarkDoneOptions) => {
  const { notificationSource } = options;

  const canExecute = (entity: EntityData): boolean => {
    if (entity.type === 'channel_message') return false;
    if (
      entity.type === 'email' ||
      entity.type === 'channel' ||
      entity.type === 'chat' ||
      entity.type === 'document' ||
      entity.type === 'project' ||
      isTaskEntity(entity)
    ) {
      return true;
    }

    return false;
  };

  const execute = async (entities: EntityData[]) => {
    const handle = markEntitiesDone({
      entities,
      notificationSource: notificationSource(),
    });

    const toastId = toast.success(
      entities.length > 1
        ? `Marked ${entities.length} items as done`
        : 'Marked as done',
      undefined,
      [
        {
          label: 'Undo',
          icon: ArrowCounterClockwise,
          onClick: () => {
            if (toastId != null) toast.dismiss(toastId);
            handle.undo().catch(() => toast.failure('Failed to undo'));
          },
        },
      ],
      10_000
    );

    handle.done.catch(() => {
      toast.failure('Failed to mark as done');
    });
  };

  const executeWithSoup = async (
    entities: EntityData[],
    soup: SoupState,
    onNavigate?: (entity: EntityData) => void
  ) => {
    const currentIndex = soup.focus.index();
    const nextEntity =
      soup.items.at(currentIndex + 1) ?? soup.items.at(currentIndex - 1);

    // Run collapse animation if conditions are met (touch modality + not-done filter active)
    if (soup.collapseEntity.shouldCollapse()) {
      const collapse = soup.collapseEntity.callback();
      if (collapse) {
        await Promise.all(entities.map((entity) => collapse(entity.id)));
      }
    }

    await execute(entities);

    soup.selection.clear();

    if (nextEntity) {
      soup.focus.set(nextEntity.id);
      onNavigate?.(nextEntity);
    }
  };

  return { canExecute, execute, executeWithSoup };
};
