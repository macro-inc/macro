import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import { toast } from '@core/component/Toast/Toast';
import { type EntityData, isTaskEntity } from '@entity';
import type { NotificationSource } from '@notifications';
import { useUndoableMutation } from '@queries/undo';
import {
  type MarkDoneHandle,
  markEntitiesDone,
  restoreSoupFocus,
} from '@app/component/next-soup/utils';
import { useMaybePreviewPanel } from '@app/component/PreviewPanel';
import type { SoupState } from '../create-soup-state';

type MakeMarkDoneOptions = {
  userId?: () => string | undefined;
  notificationSource: () => NotificationSource;
};

type MarkDoneVariables = { entities: EntityData[] };
type MarkDoneContext = {
  handle: MarkDoneHandle;
  setSuccessToastId: (id: number | undefined) => void;
};

/** Must be invoked inside a component tree that provides MutationUndoProvider. */
export const makeMarkDoneAction = (options: MakeMarkDoneOptions) => {
  const { notificationSource } = options;
  const previewPanel = useMaybePreviewPanel();
  const inPreview = previewPanel !== undefined;

  const mutation = useUndoableMutation<
    void,
    Error,
    MarkDoneVariables,
    MarkDoneContext
  >(() => ({
    mutationFn: async () => {},
    onMutate: async (variables) => {
      const handle = await markEntitiesDone({
        entities: variables.entities,
        notificationSource: notificationSource(),
      });
      let successToastId: number | undefined;
      handle.done.catch(() => {
        if (successToastId != null) toast.dismiss(successToastId);
        toast.failure('Failed to mark as done');
      });
      return {
        handle,
        setSuccessToastId: (id) => {
          successToastId = id;
        },
      };
    },
    onSuccess: (_data, variables, context) => {
      const count = variables.entities.length;
      const handle = context?.handle;
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
              handle?.undo().catch(() => toast.failure('Failed to undo'));
              restoreSoupFocus(firstEntityId, inPreview);
            },
          },
        ],
        10_000,
        true
      );
      context?.setSuccessToastId(toastId);
    },
    onError: () => {
      toast.failure('Failed to mark as done');
    },
    undoFn: async (_variables, context) => {
      await context?.handle.undo();
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
    await mutation.mutateAsync({ entities });
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
