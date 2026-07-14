import type { ListView } from '@app/constants/list-views';
import {
  applyEntitiesDoneOptimistic,
  executeMarkEntitiesDone,
  executeMarkEntitiesUndone,
  type MarkEntitiesDoneContext,
  resolveMarkEntitiesDoneVariables,
  restoreSoupFocus,
} from '@app/features/next-soup/utils';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useMaybePreviewPanel } from '@components/app/PreviewPanel';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import {
  ENABLE_NEW_INBOX_FLAG,
  ENABLE_NEW_INBOX_OVERRIDE,
} from '@core/constant/featureFlags';
import type { HotkeyGroup } from '@core/hotkey/types';
import type { EntityData } from '@entity';
import type { NotificationSource } from '@notifications';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import { type UndoHandle, useUndoableMutation } from '@queries/undo';
import type { SoupState } from '../create-soup-state';

// Valid list views where the mark done should be allowed to run
const VALID_MARK_DONE_LIST_VIEWS: `${ListView}-${string}`[] = [
  'inbox-signal',
  'inbox-noise',
  'mail-important',
  'mail-all',
  'mail-noise',
  'mail-shared',
];

export const canExecuteMarkDoneOnView = (view: ListView, tabId: string) => {
  return VALID_MARK_DONE_LIST_VIEWS.includes(`${view}-${tabId}`);
};

type MakeMarkDoneOptions = {
  userId?: () => string | undefined;
  notificationSource: () => NotificationSource;
  /** When provided, undo entries pushed by this action are dropped from
   *  the undo stack when the group is disposed. */
  hotkeyGroup?: HotkeyGroup;
};

type MarkDoneVariables = {
  entities: EntityData[];
  emailIds: string[];
  notificationIds: string[];
  restoreFocus?: () => void;
  /** Suppress the "Marked as done" toast, e.g. for send-triggered mark done
   *  where it would replace the "Email sent" toast. */
  silent?: boolean;
  /** Receives the undo handle once the mark-done is pushed onto the undo
   *  stack, so callers (e.g. undo-send) can reverse it programmatically. */
  onUndoHandle?: (handle: UndoHandle) => void;
};

type MarkDoneExecuteOpts = Pick<MarkDoneVariables, 'silent' | 'onUndoHandle'>;

/** Must be invoked inside a component tree that provides MutationUndoProvider. */
export const makeMarkDoneAction = (options: MakeMarkDoneOptions) => {
  const splitPanel = useSplitPanel();

  const newInboxFlag = useFeatureFlag(ENABLE_NEW_INBOX_FLAG, {
    enabledOverride: ENABLE_NEW_INBOX_OVERRIDE,
  });

  // Channel and channel_thread entities share the same notification bucket.
  // The new inbox renders them as separate rows, so marking a channel as done
  // should not clear thread notifications.
  //
  // TODO: This should probably be the default case after the new inbox is released
  // or we should rework how notifications are sent to not be under just the 'channel'
  // entity
  const scopeChannelNotificationsToEntity = () =>
    newInboxFlag().enabled &&
    (splitPanel?.handle.content().id === 'inbox' ||
      splitPanel?.handle.referredFrom() === 'inbox');

  const { notificationSource, hotkeyGroup } = options;
  const previewPanel = useMaybePreviewPanel();
  const inPreview = previewPanel !== undefined;

  const mutation = useUndoableMutation<
    void,
    Error,
    MarkDoneVariables,
    MarkEntitiesDoneContext
  >(() => ({
    hotkeyGroup,
    onMutate: (variables) =>
      applyEntitiesDoneOptimistic({
        entityIds: variables.entities.map((entity) => entity.id),
        emailIds: variables.emailIds,
        notificationIds: variables.notificationIds,
      }),
    mutationFn: (variables) =>
      executeMarkEntitiesDone({
        emailIds: variables.emailIds,
        notificationIds: variables.notificationIds,
      }),
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
    onPushed: (handle, variables) => {
      variables.onUndoHandle?.(handle);
      const firstEntityId = variables.entities[0]?.id;
      const count = variables.entities.length;
      const message =
        count > 1 ? `Marked ${count} items as done` : 'Marked as done';
      let toastId: number | undefined;

      const showToast = () => {
        if (variables.silent) return;
        toastId = toast.success(message, {
          actions: [
            {
              label: 'Undo',
              icon: ArrowCounterClockwise,
              onClick: () => {
                handle.undo({
                  onError: () => toast.failure('Failed to undo'),
                });
              },
            },
          ],
          duration: 3_000,
          stack: true,
          hideOnMobile: true,
        });
      };

      showToast();

      return {
        onUndone: () => {
          if (toastId !== undefined) toast.dismiss(toastId);
          variables.restoreFocus?.();
          restoreSoupFocus(firstEntityId, inPreview);
        },
        onRedone: showToast,
      };
    },
  }));

  const canExecute = (entity: EntityData): boolean => {
    if (entity.type === 'channel_message') {
      return false;
    }
    if (entity.type === 'channel_thread') {
      return scopeChannelNotificationsToEntity();
    }
    if (
      entity.type === 'email' ||
      entity.type === 'channel' ||
      entity.type === 'chat' ||
      entity.type === 'document' ||
      entity.type === 'project' ||
      entity.type === 'foreign'
    ) {
      return true;
    }

    return false;
  };

  const execute = async (
    entities: EntityData[],
    restoreFocus?: () => void,
    opts?: MarkDoneExecuteOpts
  ) => {
    const { emailIds, notificationIds } = resolveMarkEntitiesDoneVariables({
      entities,
      notificationSource: notificationSource(),
      scopeChannelNotificationsToEntity: scopeChannelNotificationsToEntity(),
    });
    await mutation.mutateAsync({
      entities,
      emailIds,
      notificationIds,
      restoreFocus,
      silent: opts?.silent,
      onUndoHandle: opts?.onUndoHandle,
    });
  };

  const executeWithSoup = async (
    entities: EntityData[],
    soup: SoupState,
    onNavigate?: (entity: EntityData) => void,
    opts?: MarkDoneExecuteOpts
  ) => {
    const currentIndex = soup.focus.index();
    const focusedIdBeforeMarkDone = soup.focus.id();
    const nextRow =
      soup.items.at(currentIndex + 1) ?? soup.items.at(currentIndex - 1);

    if (soup.collapseEntity.shouldCollapse()) {
      const collapse = soup.collapseEntity.callback();
      if (collapse) {
        await Promise.all(entities.map((entity) => collapse(entity.id)));
      }
    }

    const restoreFocus = focusedIdBeforeMarkDone
      ? () => soup.focus.set(focusedIdBeforeMarkDone)
      : undefined;

    soup.selection.clear();

    if (nextRow) {
      soup.focus.set(nextRow.id);
      onNavigate?.(nextRow.original);
    }

    await execute(entities, restoreFocus, opts);
  };

  return { canExecute, execute, executeWithSoup };
};
