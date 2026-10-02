import type { ListView } from '@app/constants/list-views';
import {
  applyEntitiesDoneOptimistic,
  executeMarkEntitiesDone,
  executeMarkEntitiesUndone,
  type MarkEntitiesDoneContext,
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
import { type UndoHandle, useMutationUndoContext } from '@queries/undo';
import { useMutation } from '@tanstack/solid-query';
import type {
  EntityActionListState,
  EntityActionNavigationHandler,
} from './entity-action-context';
import {
  createGraphqlDoneOperation,
  type DoneEntityKey,
  doneEntityKey,
} from './graphql-done-operation';

// Valid list views where the mark done should be allowed to run
const VALID_MARK_DONE_LIST_VIEWS: `${ListView}-${string}`[] = [
  'home-signal',
  'home-noise',
  // Marking a pending reminder done cancels it before it fires — same as the
  // standalone Reminders collection below.
  'home-reminders',
  'mail-important',
  'mail-all',
  'mail-noise',
  'mail-favorites',
  // Calendar lists invite threads from the "all" email view, so done rows
  // stay in place and flip to the done state exactly like mail "All".
  'mail-calendar',
  'mail-shared',
  'reminders-all',
];

export const canExecuteMarkDoneOnView = (view: ListView, tabId: string) => {
  return VALID_MARK_DONE_LIST_VIEWS.includes(`${view}-${tabId}`);
};

/** Already-done emails and reminders coexist with actionable rows in unified
 * collections, so mark-done skips them rather than acknowledging twice. */
const isMarkDoneTarget = (e: EntityData) =>
  !(e.type === 'email' && e.done === true) &&
  !(e.type === 'reminder' && e.completedAt != null);

const isEmailFollowupReminder = (entity: EntityData) =>
  entity.type === 'reminder' && Boolean(entity.emailFollowup);

type MakeMarkDoneOptions = {
  userId?: () => string | undefined;
  notificationSource: () => NotificationSource;
  /** When provided, undo entries pushed by this action are dropped from
   *  the undo stack when the group is disposed. */
  hotkeyGroup?: HotkeyGroup;
};

type MarkDoneVariables = {
  /** Snapshot the transport when this action starts, not when its reply lands. */
  earlyUndo: boolean;
  operation?: ReturnType<typeof createGraphqlDoneOperation>;
  entities: EntityData[];
  emailIds: string[];
  /** Locally known IDs used only for the immediate optimistic cache patch. */
  optimisticNotificationIds: string[];
  notificationIdsByEntity: ReadonlyMap<DoneEntityKey, string[]>;
  scopeChannelThreads: boolean;
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

type PendingDoneUndo = {
  requested: boolean;
  result: Promise<boolean>;
  finish: (accepted: boolean) => void;
};

function createPendingDoneUndo(): PendingDoneUndo {
  let finish!: PendingDoneUndo['finish'];
  const result = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  return { requested: false, result, finish };
}

type MarkDoneContext = MarkEntitiesDoneContext & {
  operation?: ReturnType<typeof createGraphqlDoneOperation>;
  pendingUndo?: PendingDoneUndo;
  registration?: {
    handle: UndoHandle;
    dismiss: () => void;
    showToast: () => void;
  };
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
    splitPanel?.handle.content().id === 'home' ||
    splitPanel?.handle.referredFrom() === 'home';

  const { notificationSource, hotkeyGroup } = options;
  const { pushUndo } = useMutationUndoContext();

  const registerUndo = (
    variables: MarkDoneVariables,
    context: MarkDoneContext
  ) => {
    // Workflow mirrors can only be reopened with a new time in their composer.
    // Never publish a generic Undo handle, including during the pending write.
    if (variables.entities.some(isEmailFollowupReminder)) {
      if (!variables.silent) {
        if (context.operation?.hasFailures())
          toast.alert('Some changes could not be saved.');
        else
          toast.success(
            'Marked as done. Use Remind me to schedule the email again.'
          );
      }
      return;
    }
    const firstEntityId = variables.entities[0]?.id;
    let toastId: number | undefined;
    let disposed = false;
    const dismiss = () => {
      if (toastId !== undefined) toast.dismiss(toastId);
    };
    const restoreFocus = () => {
      dismiss();
      variables.restoreFocus?.();
      void restoreSoupFocus(firstEntityId);
      variables.navigateBack?.();
    };
    const showToast = () => {
      if (variables.silent || disposed) return;
      const total = variables.entities.length;
      const failed = context.operation?.hasFailures();
      const partial = failed || context.operation?.hasNoopRows();
      const message = partial
        ? `Marked ${context.operation?.completedCount()} of ${total} items as done${failed ? '. Some changes could not be saved.' : ''}`
        : total > 1
          ? `Marked ${total} items as done`
          : 'Marked as done';
      toastId = (partial ? toast.alert : toast.success)(message, {
        actions: [
          {
            label: 'Undo',
            icon: ArrowCounterClockwise,
            onClick: () => {
              void handle.undo({
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
    const stackHandle = pushUndo({
      label: 'Mark Done',
      undo: async () => {
        if (context.pendingUndo) context.pendingUndo.requested = true;
        context.applyUndone();
        if (context.pendingUndo) {
          // Display and focus reverse now; the write must wait for exact IDs.
          restoreFocus();
          if (!(await context.pendingUndo.result)) return;
        }
        try {
          if (context.operation) await context.operation.undo();
          else {
            await executeMarkEntitiesUndone({
              emailIds: variables.emailIds,
              notificationIds: variables.exactNotificationIds.current,
              reminderIds: variables.reminderIds,
            });
            context.settle(variables.exactNotificationIds.current);
          }
        } catch (err) {
          if (!context.operation) {
            context.reapply();
            context.releaseGraphql();
          }
          throw err;
        }
      },
      redo: async () => {
        context.reapply();
        try {
          if (context.operation) await context.operation.redo();
          else {
            await executeMarkEntitiesDone({
              emailIds: variables.emailIds,
              notificationIds: variables.exactNotificationIds.current,
              reminderIds: variables.reminderIds,
            });
            context.settle(variables.exactNotificationIds.current);
          }
        } catch (err) {
          if (!context.operation) {
            context.applyUndone();
            context.releaseGraphql();
          }
          throw err;
        }
      },
      onUndone: context.pendingUndo ? undefined : restoreFocus,
      onRedone: showToast,
    });
    const handle: UndoHandle = {
      ...stackHandle,
      dispose: () => {
        disposed = true;
        stackHandle.dispose();
        dismiss();
      },
    };
    context.registration = { handle, dismiss, showToast };
    hotkeyGroup?.addDisposer(handle.dispose);
    showToast();
    variables.onUndoHandle?.(handle);
  };

  const mutation = useMutation<void, Error, MarkDoneVariables, MarkDoneContext>(
    () => ({
      onMutate: (variables) => {
        const operation = variables.earlyUndo
          ? createGraphqlDoneOperation({
              ...variables,
              notificationIds: variables.exactNotificationIds.current,
            })
          : undefined;
        variables.operation = operation;
        const context: MarkDoneContext = {
          ...(operation ??
            applyEntitiesDoneOptimistic({
              entityIds: variables.entities.map((entity) => entity.id),
              emailIds: variables.emailIds,
              notificationIds: variables.optimisticNotificationIds,
              reminderIds: variables.reminderIds,
              scopeChannelThreads: variables.scopeChannelThreads,
            })),
          operation,
          pendingUndo:
            variables.earlyUndo &&
            !variables.entities.some(isEmailFollowupReminder)
              ? createPendingDoneUndo()
              : undefined,
        };
        if (context.pendingUndo) registerUndo(variables, context);
        return context;
      },
      mutationFn: async (variables) => {
        if (variables.operation) return variables.operation.execute();
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
      onSuccess: (_data, variables, context) => {
        if (!context) return;
        // A late Done acknowledgement must not settle the newer Undo display
        // intent before its reversal has written anything.
        if (!context.pendingUndo?.requested) {
          context.settle(variables.exactNotificationIds.current);
        }
        if (context.pendingUndo) {
          const accepted = context.operation?.hasAccepted() ?? false;
          if (!accepted) {
            context.registration?.handle.dispose();
            context.registration?.dismiss();
          } else if (
            context.operation?.hasFailures() ||
            context.operation?.hasNoopRows()
          ) {
            context.registration?.dismiss();
            if (!context.pendingUndo.requested)
              context.registration?.showToast();
            else if (context.operation?.hasFailures()) {
              toast.alert(
                'Some changes could not be saved. Undo will reverse the accepted changes.'
              );
            }
          }
          context.pendingUndo.finish(accepted);
        } else registerUndo(variables, context);
      },
      onError: (_err, _variables, context) => {
        context?.registration?.handle.dispose();
        context?.registration?.dismiss();
        context?.rollback();
        context?.pendingUndo?.finish(false);
        toast.failure('Failed to mark as done');
      },
    })
  );

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
      // Agent-session rows exist in the inbox only through their settled /
      // waiting-for-input / mentioned notifications, so done resolves to
      // those notification ids like every other notification-backed type.
      entity.type === 'agent_session' ||
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
  ): Promise<void> => {
    // Skip already-done emails so a mixed selection (e.g. done + not-done rows
    // in mail "All") doesn't re-archive the done ones or overcount the toast.
    const useEntityMutations = isFeatureEnabled(enableGraphqlSoup);
    const eligible = entities.filter(isMarkDoneTarget);
    const targets = useEntityMutations
      ? [
          ...new Map(
            eligible.map((entity) => [doneEntityKey(entity), entity])
          ).values(),
        ]
      : eligible;
    if (targets.length === 0) return;

    // Only workflow mirrors lack generic undo. Keep reversible selections in
    // their own transaction so a mixed selection retains its normal Undo.
    const mirrors = targets.filter(isEmailFollowupReminder);
    if (mirrors.length > 0 && mirrors.length < targets.length) {
      let failure: { reason: unknown } | undefined;
      // Settle mirrors first so their non-undoable entry cannot overwrite the
      // ordinary group's Undo toast or clear its Redo stack after completion.
      // A failed group must not prevent the remaining writes from being tried.
      for (const attempt of [
        () => execute(mirrors, undefined, { silent: opts?.silent }),
        () =>
          execute(
            targets.filter((entity) => !mirrors.includes(entity)),
            restoreFocus,
            opts
          ),
      ]) {
        try {
          await attempt();
        } catch (reason) {
          failure ??= { reason };
        }
      }
      if (failure) throw failure.reason;
      return;
    }

    const source = notificationSource();
    const scopeChannelNotifications = scopeChannelNotificationsToEntity();
    const resolved = resolveMarkEntitiesDoneVariables({
      entities: targets,
      notificationSource: source,
      scopeChannelNotificationsToEntity: scopeChannelNotifications,
    });

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

    const notificationIdsByEntity = new Map<DoneEntityKey, string[]>();
    if (useEntityMutations) {
      for (const entity of targets) {
        notificationIdsByEntity.set(
          doneEntityKey(entity),
          resolveMarkEntitiesDoneVariables({
            entities: [entity],
            notificationSource: source,
            scopeChannelNotificationsToEntity: scopeChannelNotifications,
          }).notificationIds
        );
      }
    }

    await mutation.mutateAsync({
      earlyUndo: useEntityMutations,
      entities: targets,
      emailIds: resolved.emailIds,
      optimisticNotificationIds: resolved.notificationIds,
      notificationIdsByEntity,
      scopeChannelThreads: scopeChannelNotifications,
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
    onNavigate?: EntityActionNavigationHandler,
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
    } else {
      soup.focus.set(undefined);
    }

    if (onNavigate) {
      onNavigate({
        actionId: 'mark-done',
        entity: nextRow?.original,
      });
    }

    // When marking done navigated the view to the next item, undo navigates
    // back to the marked entity through the same callback.
    const firstEntity = targets[0];
    const navigateBack =
      opts?.navigateBack ??
      (onNavigate && firstEntity
        ? () =>
            onNavigate({
              actionId: 'mark-done',
              entity: firstEntity,
            })
        : undefined);

    await execute(targets, restoreFocus, { ...opts, navigateBack });
  };

  return { canExecute, execute, executeWithSoup };
};
