import type { ListView } from '@app/constants/list-views';
import {
  applyEntitiesDoneOptimistic,
  executeMarkEntitiesDone,
  executeMarkEntitiesUndone,
  type MarkEntitiesDoneContext,
  openEntityInSplitFromUnifiedList,
  resolveMarkEntitiesDoneVariables,
  restoreSoupFocus,
} from '@app/features/next-soup/utils';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import type { HotkeyGroup } from '@core/hotkey/types';
import type { EntityData } from '@entity';
import type { NotificationSource } from '@notifications';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import {
  type NotificationEntityRef,
  toNotificationEntityRef,
} from '@queries/notification/entity-mutations';
import { type UndoHandle, useUndoableMutation } from '@queries/undo';
import type { EntityActionListState } from './entity-action-context';

// Valid list views where the mark done should be allowed to run
const VALID_MARK_DONE_LIST_VIEWS: `${ListView}-${string}`[] = [
  'inbox-signal',
  'inbox-noise',
  // Marking a pending reminder done cancels it before it fires — same as the
  // standalone Reminders view's Scheduled tab below.
  'inbox-reminders',
  'mail-important',
  'mail-all',
  'mail-noise',
  'mail-shared',
  // Completing a reminder is the whole point of the Reminders view: without
  // it the only way to clear one is to delete it. Done is listed too so a
  // reminder marked by mistake can be reopened from where it landed.
  'reminders-active',
  'reminders-scheduled',
  'reminders-done',
];

export const canExecuteMarkDoneOnView = (view: ListView, tabId: string) => {
  return VALID_MARK_DONE_LIST_VIEWS.includes(`${view}-${tabId}`);
};

/** Already-done emails are skipped by mark-done (they appear alongside
 *  not-done rows in views that show done content, e.g. mail "All"). done
 *  state is email-specific; other entity types are never filtered. */
const isMarkDoneTarget = (e: EntityData) =>
  !(e.type === 'email' && e.done === true);

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
  /** Locally known IDs used only for the immediate optimistic cache patch. */
  optimisticNotificationIds: string[];
  /** Exact IDs used by undo/redo; entity mutation results are appended here. */
  exactNotificationIds: { current: string[] };
  /** Entity-wide targets used only by the initial committed mark-done. */
  notificationEntities: NotificationEntityRef[];
  reminderIds: string[];
  restoreFocus?: () => void;
  /** Suppress the "Marked as done" toast, e.g. for send-triggered mark done
   *  where it would replace the "Email sent" toast. */
  silent?: boolean;
  /** Receives the undo handle once the mark-done is pushed onto the undo
   *  stack, so callers (e.g. undo-send) can reverse it programmatically. */
  onUndoHandle?: (handle: UndoHandle) => void;
  /** Navigates the view back to the marked entity on undo, when marking done
   *  navigated away to the next item. */
  navigateBack?: () => void;
};

type MarkDoneExecuteOpts = Pick<
  MarkDoneVariables,
  'silent' | 'onUndoHandle' | 'navigateBack'
>;

type MarkDoneExecuteWithSoupOpts = MarkDoneExecuteOpts & {
  anchorKey?: string;
  nextEntityId?: string;
};

/** Must be invoked inside a component tree that provides MutationUndoProvider. */
export const makeMarkDoneAction = (options: MakeMarkDoneOptions) => {
  const splitPanel = useSplitPanel();

  // Channel and channel_thread entities share the same notification bucket.
  // The inbox renders them as separate rows, so marking a channel as done
  // should not clear thread notifications.
  //
  // TODO: This should probably be the default case everywhere, or we should
  // rework how notifications are sent to not be under just the 'channel'
  // entity
  const scopeChannelNotificationsToEntity = () =>
    splitPanel?.handle.content().id === 'inbox' ||
    splitPanel?.handle.referredFrom() === 'inbox';

  const { notificationSource, hotkeyGroup } = options;
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
        notificationIds: variables.optimisticNotificationIds,
        reminderIds: variables.reminderIds,
      }),
    mutationFn: async (variables) => {
      const authoritativeNotificationIds = await executeMarkEntitiesDone({
        emailIds: variables.emailIds,
        notificationIds: variables.exactNotificationIds.current,
        notificationEntities: variables.notificationEntities,
        reminderIds: variables.reminderIds,
      });
      variables.exactNotificationIds.current = [
        ...new Set([
          ...variables.exactNotificationIds.current,
          ...authoritativeNotificationIds,
        ]),
      ];
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
          notificationIds: variables.exactNotificationIds.current,
          reminderIds: variables.reminderIds,
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
          notificationIds: variables.exactNotificationIds.current,
          reminderIds: variables.reminderIds,
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
          restoreSoupFocus(firstEntityId);
          variables.navigateBack?.();
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
      entity.type === 'foreign' ||
      // Marked done by hand like everything else — opening a reminder does not
      // dismiss it. Signal gates on the not-done notification either way.
      entity.type === 'reminder' ||
      // A calendar event row exists in Signal only through its not-done
      // reminder notification, so done resolves to those notification ids.
      entity.type === 'calendar_event'
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
    // Skip already-done emails so a mixed selection (e.g. done + not-done rows
    // in mail "All") doesn't re-archive the done ones or overcount the toast.
    const targets = entities.filter(isMarkDoneTarget);
    if (targets.length === 0) return;

    const source = notificationSource();
    const scopeChannelNotifications = scopeChannelNotificationsToEntity();
    const resolved = resolveMarkEntitiesDoneVariables({
      entities: targets,
      notificationSource: source,
      scopeChannelNotificationsToEntity: scopeChannelNotifications,
    });

    const useEntityMutations = isFeatureEnabled(enableGraphqlSoup);
    // A whole-channel row in the new inbox intentionally excludes notification
    // stacks rendered as separate thread rows. The entity endpoint cannot
    // express "channel except its threads", so only that selective case keeps
    // an initial ID-scoped write. Channel-thread rows can use their canonical
    // message entity because reply notifications point back to it as their
    // secondary entity.
    const selectiveChannelEntities: EntityData[] =
      useEntityMutations && scopeChannelNotifications
        ? targets.filter((entity) => entity.type === 'channel')
        : [];
    const selectiveChannelIds =
      selectiveChannelEntities.length === 0
        ? []
        : resolveMarkEntitiesDoneVariables({
            entities: selectiveChannelEntities,
            notificationSource: source,
            scopeChannelNotificationsToEntity: true,
          }).notificationIds;

    const notificationEntities: NotificationEntityRef[] = useEntityMutations
      ? targets.flatMap((entity) => {
          if (selectiveChannelEntities.includes(entity)) return [];
          const entityRef = toNotificationEntityRef(entity);
          return entityRef ? [entityRef] : [];
        })
      : [];

    const exactNotificationIds = useEntityMutations
      ? selectiveChannelIds
      : resolved.notificationIds;

    await mutation.mutateAsync({
      entities: targets,
      emailIds: resolved.emailIds,
      optimisticNotificationIds: resolved.notificationIds,
      exactNotificationIds: { current: exactNotificationIds },
      notificationEntities,
      reminderIds: resolved.reminderIds,
      restoreFocus,
      silent: opts?.silent,
      onUndoHandle: opts?.onUndoHandle,
      navigateBack: opts?.navigateBack,
    });
  };

  const executeWithSoup = async (
    entities: EntityData[],
    soup: EntityActionListState,
    onNavigate?: (entity: EntityData) => void,
    opts?: MarkDoneExecuteWithSoupOpts
  ) => {
    // Apply execute's already-done filter up front so navigation, selection
    // clearing, collapse, and the undo target all reflect what's actually
    // marked (and nothing happens when nothing will be).
    const targets = entities.filter(isMarkDoneTarget);
    if (targets.length === 0) return;

    const focusedIdBeforeMarkDone = opts?.anchorKey ?? soup.focus.id();
    const markedEntityIds = new Set(targets.map((entity) => entity.id));
    const adjacentRow = (direction: 1 | -1) => {
      let previousCandidateIndex: number | undefined;

      for (let distance = 1; distance <= soup.items.count(); distance++) {
        const candidate = soup.navigate.peekOffset(direction * distance, {
          wrapNavigation: false,
          skipGroupHeaders: true,
          skipLoadMore: true,
        });

        // Peeking clamps at list boundaries, so a repeated index means there
        // are no more candidates in this direction.
        if (!candidate || candidate.index === previousCandidateIndex) return;
        previousCandidateIndex = candidate.index;

        if (
          candidate.row.id === focusedIdBeforeMarkDone ||
          markedEntityIds.has(candidate.row.original.id)
        ) {
          continue;
        }

        return candidate.row;
      }
    };
    const fallbackNextRow = adjacentRow(1) ?? adjacentRow(-1);
    const nextRow = opts?.nextEntityId
      ? (soup.items.get(opts.nextEntityId) ?? fallbackNextRow)
      : fallbackNextRow;

    if (soup.collapseEntity.shouldCollapse()) {
      const collapse = soup.collapseEntity.callback();
      if (collapse) {
        await Promise.all(targets.map((entity) => collapse(entity.id)));
      }
    }

    const restoreFocus = focusedIdBeforeMarkDone
      ? () => soup.focus.set(focusedIdBeforeMarkDone)
      : undefined;

    soup.selection.clear();

    if (nextRow) {
      soup.focus.set(nextRow.id);
      const controller = splitPanel?.handle;
      if (controller?.isControllerSplit()) {
        void openEntityInSplitFromUnifiedList(nextRow.original, {
          splitHandle: controller,
          mergeHistory: true,
          notificationSource: options.notificationSource(),
        });
      }
      onNavigate?.(nextRow.original);
    }

    // When marking done navigated the view to the next item, undo navigates
    // back to the marked entity through the same callback.
    const firstEntity = targets[0];
    const navigateBack =
      opts?.navigateBack ??
      (nextRow && onNavigate && firstEntity
        ? () => onNavigate(firstEntity)
        : undefined);

    await execute(targets, restoreFocus, { ...opts, navigateBack });
  };

  return { canExecute, execute, executeWithSoup };
};
