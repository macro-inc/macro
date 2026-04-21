import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import { toast } from '@core/component/Toast/Toast';
import { type EntityData, isTaskEntity } from '@entity';
import type { NotificationSource } from '@notifications';
import { useMutationUndoContext, useUndoableMutation } from '@queries/undo';
import {
  applyEntitiesDoneOptimistic,
  executeMarkEntitiesDone,
  executeMarkEntitiesUndone,
  type MarkEntitiesDoneContext,
  resolveMarkEntitiesDoneVariables,
  restoreSoupFocus,
} from '@app/component/next-soup/utils';
import { useMaybePreviewPanel } from '@app/component/PreviewPanel';
import type { SoupState } from '../create-soup-state';

type MakeMarkDoneOptions = {
  userId?: () => string | undefined;
  notificationSource: () => NotificationSource;
};

type MarkDoneVariables = {
  entities: EntityData[];
  emailIds: string[];
  notificationIds: string[];
};

/** Must be invoked inside a component tree that provides MutationUndoProvider. */
export const makeMarkDoneAction = (options: MakeMarkDoneOptions) => {
  const { notificationSource } = options;
  const previewPanel = useMaybePreviewPanel();
  const inPreview = previewPanel !== undefined;
  const undoCtx = useMutationUndoContext();

  const mutation = useUndoableMutation<
    void,
    Error,
    MarkDoneVariables,
    MarkEntitiesDoneContext
  >(() => ({
    onMutate: (variables) =>
      applyEntitiesDoneOptimistic({
        emailIds: variables.emailIds,
        notificationIds: variables.notificationIds,
      }),
    mutationFn: async (variables) =>
      await executeMarkEntitiesDone({
        emailIds: variables.emailIds,
        notificationIds: variables.notificationIds,
      }),
    onSuccess: (_data, variables) => {
      const count = variables.entities.length;
      const firstEntityId = variables.entities[0]?.id;
      const toastId = toast.success(
        count > 1 ? `Marked ${count} items as done` : 'Marked as done',
        undefined,
        [
          {
            label: 'Undo',
            icon: ArrowCounterClockwise,
            onClick: () => {
              if (toastId != null) toast.dismiss(toastId);
              // Route through the undo stack so the entry is popped and
              // Cmd+Z / shift+Cmd+Z stay in sync with the toast action.
              undoCtx.undo({
                onError: () => toast.failure('Failed to undo'),
              });
              restoreSoupFocus(firstEntityId, inPreview);
            },
          },
        ],
        10_000,
        true
      );
    },
    onError: (_err, _variables, context) => {
      context?.rollback();
      toast.failure('Failed to mark as done');
    },
    undoFn: async (variables, context) => {
      context?.applyUndone();
      try {
        await executeMarkEntitiesUndone({
          emailIds: variables.emailIds,
          notificationIds: variables.notificationIds,
        });
      } catch (err) {
        context?.reapply();
        throw err;
      }
    },
    redoFn: async (variables, context) => {
      context?.reapply();
      try {
        await executeMarkEntitiesDone({
          emailIds: variables.emailIds,
          notificationIds: variables.notificationIds,
        });
      } catch (err) {
        context?.applyUndone();
        throw err;
      }
    },
    undoLabel: 'Mark Done',
  }));

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
    const { emailIds, notificationIds } = resolveMarkEntitiesDoneVariables({
      entities,
      notificationSource: notificationSource(),
    });
    await mutation.mutateAsync({ entities, emailIds, notificationIds });
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
