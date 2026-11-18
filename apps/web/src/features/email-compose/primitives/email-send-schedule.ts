import { fireAndForget } from '@core/util/fireAndForget';
import { format } from 'date-fns/format';
import { isThisYear } from 'date-fns/isThisYear';
import { type Accessor, createSignal } from 'solid-js';
import type {
  EmailComposeFeedback,
  EmailDelivery,
  EmailDraftLifecycleState,
} from '../context/compose-capabilities';

export type EmailDeliveryIntent =
  | { type: 'immediate' }
  | { type: 'later'; sendTime: Date };

export type EmailScheduleState =
  | { type: 'editing'; intent: EmailDeliveryIntent }
  | {
      type: 'scheduled';
      confirmedTime: Date;
      proposedTime?: Date;
      deliveryStatus?: 'pending' | 'sending' | 'failed' | 'unconfirmed';
    };

export type EmailScheduleAction =
  | 'send'
  | 'schedule'
  | 'update'
  | 'unavailable';

export function scheduleTimeLocked(state: EmailScheduleState) {
  return (
    state.type === 'scheduled' &&
    state.deliveryStatus !== undefined &&
    state.deliveryStatus !== 'pending'
  );
}

export function getScheduleSelection(state: EmailScheduleState) {
  if (state.type === 'editing') {
    return state.intent.type === 'later' ? state.intent.sendTime : undefined;
  }
  return state.proposedTime ?? state.confirmedTime;
}

export function getScheduleAction(
  state: EmailScheduleState
): EmailScheduleAction {
  if (state.type === 'editing') {
    return state.intent.type === 'later' ? 'schedule' : 'send';
  }
  if (scheduleTimeLocked(state)) return 'unavailable';
  return state.proposedTime ? 'update' : 'unavailable';
}

export function getScheduleActionLabel(state: EmailScheduleState) {
  switch (getScheduleAction(state)) {
    case 'schedule':
      return 'Schedule send';
    case 'update':
      return 'Update schedule';
    default:
      return 'Send email';
  }
}

const sameTime = (left: Date, right: Date) =>
  left.getTime() === right.getTime();

// A schedule's notice outlives the composer that made it: showing the thread
// mounts another composer for the same draft, which may cancel or deliver it.
// That composer can read the draft from before the schedule, so while the
// notice is open it starts from the time this tab scheduled.
type ScheduledNotice = {
  toastId: number | undefined;
  sendTime: Date;
  seedUntil: number;
};
const scheduledNotices = new Map<string, ScheduledNotice>();
// How long a notice's schedule seeds new composers: far longer than the
// thread takes to refresh after a schedule. A notice dismissed before it was
// ever shown never reports closing, and its schedule may since have been
// cancelled elsewhere.
const SCHEDULED_SEED_MS = 30_000;

/** Forgets every notice's schedule, so one test's schedule seeds no other. */
export function resetScheduledNoticesForTests(): void {
  scheduledNotices.clear();
}

export function createEmailSendSchedule(options: {
  delivery: Pick<EmailDelivery, 'schedule' | 'unschedule' | 'archive'>;
  notices: EmailComposeFeedback;
  initialScheduledTime?: Date;
  initialDeliveryStatus?: Extract<
    EmailScheduleState,
    { type: 'scheduled' }
  >['deliveryStatus'];
  draftId: Accessor<string | null | undefined>;
  draftGeneration?: Accessor<number>;
  saveDraft: () => Promise<string | undefined>;
  threadId: Accessor<string | null | undefined>;
  /** Scheduling marks the thread done only when this reports it in the inbox. */
  threadInInbox?: Accessor<boolean | undefined>;
  inboxId: Accessor<string | undefined>;
  includeSignature: Accessor<boolean | undefined>;
  /** Changes whenever the persisted draft identity or editable content changes. */
  generation: Accessor<string>;
  lifecycleState?: Accessor<EmailDraftLifecycleState | undefined>;
  reconcile?: () => Promise<EmailDraftLifecycleState | undefined>;
  reconcileIdentity?: (input: {
    draftId: string;
    threadId: string;
    inboxId?: string;
  }) => Promise<EmailDraftLifecycleState | undefined>;
  onScheduleUndone?: (input: {
    draftId: string;
    threadId: string | undefined;
    inboxId: string | undefined;
    sendTime: Date;
  }) => Promise<void> | void;
  /** Opens the scheduled message; the success notice offers it when present. */
  onViewScheduled?: (input: {
    draftId: string;
    threadId: string | undefined;
    inboxId: string | undefined;
  }) => void;
}) {
  const { delivery, notices } = options;
  const initialDraftId = options.draftId() ?? undefined;
  const seed = initialDraftId
    ? scheduledNotices.get(initialDraftId)
    : undefined;
  const seededTime =
    seed && Date.now() < seed.seedUntil ? seed.sendTime : undefined;
  // This tab's own schedule is newer than a read of the draft made before it.
  const initialScheduledTime = seededTime ?? options.initialScheduledTime;
  // A read of another schedule says nothing about how this one is delivering.
  const readDescribesSchedule =
    !seededTime ||
    (options.initialScheduledTime !== undefined &&
      sameTime(seededTime, options.initialScheduledTime));
  const [state, setState] = createSignal<EmailScheduleState>(
    initialScheduledTime
      ? {
          type: 'scheduled',
          confirmedTime: initialScheduledTime,
          deliveryStatus: readDescribesSchedule
            ? options.initialDeliveryStatus
            : undefined,
        }
      : { type: 'editing', intent: { type: 'immediate' } }
  );
  const [operation, setOperation] = createSignal<
    'idle' | 'committing' | 'updating' | 'cancelling'
  >('idle');
  let selectionRevision = 0;
  let ignoredLifecycleObservation: EmailDraftLifecycleState | undefined;
  let deferredLifecycleObservation: EmailDraftLifecycleState | undefined;
  // The "Email scheduled" notice offers Undo only while that schedule stands.
  // Remember the draft it belongs to past a composer's session reset.
  let scheduledDraftId = initialScheduledTime ? initialDraftId : undefined;
  const dismissScheduledNotice = () => {
    const draftId = scheduledDraftId ?? options.draftId();
    const notice = draftId ? scheduledNotices.get(draftId) : undefined;
    if (!draftId || !notice) return;
    scheduledNotices.delete(draftId);
    if (notice.toastId != null) notices.feedback.dismiss(notice.toastId);
  };

  const pending = () => operation() !== 'idle';
  const selectedTime = () => getScheduleSelection(state());
  const confirmedTime = () => {
    const current = state();
    return current.type === 'scheduled' ? current.confirmedTime : undefined;
  };

  /** Picker changes are deliberately local. They never mutate delivery state. */
  const select = (date: Date | null): boolean => {
    if (pending()) return false;
    const before = state();
    if (scheduleTimeLocked(before)) return false;
    selectionRevision += 1;
    setState((current) => {
      if (current.type === 'editing') {
        return date
          ? { type: 'editing', intent: { type: 'later', sendTime: date } }
          : { type: 'editing', intent: { type: 'immediate' } };
      }

      if (!date || sameTime(date, current.confirmedTime)) {
        return { ...current, proposedTime: undefined };
      }
      return {
        ...current,
        proposedTime: date,
      };
    });
    return true;
  };

  const applyScheduled = (
    sendTime: Date,
    replaceProposal = false,
    deliveryStatus?: Extract<
      EmailScheduleState,
      { type: 'scheduled' }
    >['deliveryStatus']
  ) => {
    const current = state();
    if (
      !replaceProposal &&
      current.type === 'scheduled' &&
      sameTime(current.confirmedTime, sendTime) &&
      current.proposedTime &&
      (!deliveryStatus || deliveryStatus === 'pending')
    ) {
      setState({ ...current, deliveryStatus });
      return;
    }
    scheduledDraftId = options.draftId() ?? scheduledDraftId;
    // Seen at another time, the schedule this tab announced has moved since:
    // composers mounted from now on start from where it went, and its notice
    // keeps its Undo.
    const recorded = scheduledDraftId
      ? scheduledNotices.get(scheduledDraftId)
      : undefined;
    if (recorded) recorded.sendTime = sendTime;
    selectionRevision += 1;
    setState({ type: 'scheduled', confirmedTime: sendTime, deliveryStatus });
  };

  const applyEditing = () => {
    if (state().type !== 'scheduled') return;
    dismissScheduledNotice();
    selectionRevision += 1;
    setState({ type: 'editing', intent: { type: 'immediate' } });
  };

  /**
   * Apply only authoritative server lifecycle. An ordinary editing observation
   * intentionally leaves a local, unconfirmed time choice intact.
   */
  const observe = (next: EmailDraftLifecycleState) => {
    if (pending()) {
      deferredLifecycleObservation = next;
      return;
    }
    if (next === ignoredLifecycleObservation) return;
    if (next.type === 'scheduled') {
      applyScheduled(new Date(next.sendTime), false, next.deliveryStatus);
      return;
    }
    if (next.type === 'editing') applyEditing();
  };

  const reconcileScheduleFailure = async (requested: Date) => {
    try {
      const authoritative = await options.reconcile?.();
      if (
        authoritative?.type === 'scheduled' &&
        new Date(authoritative.sendTime).getTime() === requested.getTime()
      ) {
        return true;
      }
    } catch (error) {
      notices.reportError(error);
    }
    return false;
  };

  const undoInitialSchedule = async (input: {
    draftId: string;
    draftGeneration: number | undefined;
    threadId: string | undefined;
    inboxId: string | undefined;
    sendTime: Date;
    markedDone: boolean;
  }) => {
    try {
      await delivery.unschedule({
        draftGeneration: input.draftGeneration,
        draftId: input.draftId,
        threadId: input.threadId,
        inboxId: input.inboxId,
      });
    } catch (error) {
      notices.reportError(error);
      try {
        const authoritative =
          input.threadId && options.reconcileIdentity
            ? await options.reconcileIdentity({
                draftId: input.draftId,
                threadId: input.threadId,
                inboxId: input.inboxId,
              })
            : await options.reconcile?.();
        const matchesCapturedIdentity =
          authoritative?.draftId === input.draftId &&
          (input.threadId === undefined ||
            authoritative.threadId === input.threadId) &&
          (input.inboxId === undefined ||
            authoritative.inboxId === input.inboxId);
        if (matchesCapturedIdentity && authoritative?.type === 'editing') {
          // A lost cancellation response is still a successful undo.
        } else if (matchesCapturedIdentity && authoritative?.type === 'sent') {
          notices.feedback.alert(
            'This email was already sent and can no longer be unscheduled.'
          );
          return;
        } else {
          notices.feedback.failure('Failed to undo scheduled send');
          return;
        }
      } catch (refreshError) {
        notices.reportError(refreshError);
        notices.feedback.failure('Failed to undo scheduled send');
        return;
      }
    }

    if (options.draftId() === input.draftId) applyEditing();
    if (input.markedDone && input.threadId) {
      try {
        await delivery.archive(
          { threadId: input.threadId, value: false },
          input.inboxId
        );
      } catch (error) {
        notices.reportError(error);
        notices.feedback.failure('Failed to restore thread to inbox');
      }
    }
    try {
      await options.onScheduleUndone?.(input);
      notices.feedback.success('Schedule cancelled.');
    } catch (error) {
      notices.reportError(error);
      notices.feedback.alert(
        'Schedule cancelled, but the draft could not be reopened. Check Drafts.'
      );
    }
  };

  const submit = async (): Promise<'scheduled' | 'updated' | false> => {
    const before = state();
    const action = getScheduleAction(before);
    if (action !== 'schedule' && action !== 'update') return false;
    if (pending()) return false;

    const requested = getScheduleSelection(before);
    if (!requested || !Number.isFinite(requested.getTime())) {
      notices.feedback.alert('Choose a valid send time.');
      return false;
    }
    if (requested.getTime() <= Date.now()) {
      notices.feedback.alert(
        'That send time has passed. Choose a future time.'
      );
      return false;
    }

    const revision = selectionRevision;
    const generation = options.generation();
    const inboxId = options.inboxId();
    deferredLifecycleObservation = undefined;
    setOperation(action === 'update' ? 'updating' : 'committing');
    try {
      let draftId: string | undefined;
      if (action === 'schedule') {
        try {
          draftId = await options.saveDraft();
        } catch {
          // Persistence owns its specific feedback. Never fall through to Send.
          return false;
        }
      } else {
        // A confirmed schedule is content-locked; updating its time must not
        // rewrite the draft body through the ordinary autosave endpoint.
        draftId = options.draftId() ?? undefined;
      }
      if (
        revision !== selectionRevision ||
        generation !== options.generation() ||
        inboxId !== options.inboxId()
      ) {
        return false;
      }
      if (!draftId) {
        notices.feedback.failure(
          action === 'update'
            ? 'Failed to update schedule'
            : 'Failed to schedule email',
          {
            subtext:
              'Draft is not ready to schedule. Resolve any save or connection errors and try again',
          }
        );
        return false;
      }

      // Undo runs after a reply composer has reset, so it keeps this value.
      const draftGeneration = options.draftGeneration?.();
      try {
        await delivery.schedule(
          {
            draftGeneration,
            draftId,
            threadId: options.threadId() ?? undefined,
            sendTime: requested.toISOString(),
            includeSignature: options.includeSignature(),
          },
          inboxId
        );
      } catch (error) {
        notices.reportError(error);
        if (!(await reconcileScheduleFailure(requested))) {
          notices.feedback.failure(
            action === 'update'
              ? 'Failed to update schedule'
              : 'Failed to schedule email'
          );
          return false;
        }
      }

      if (
        revision !== selectionRevision ||
        generation !== options.generation() ||
        inboxId !== options.inboxId()
      ) {
        await options.reconcile?.().catch(notices.reportError);
        return false;
      }

      applyScheduled(requested, true);
      // In place before the thread is marked done: a composer mounted for this
      // draft from now on starts from this schedule.
      dismissScheduledNotice();
      const notice: ScheduledNotice = {
        toastId: undefined,
        sendTime: requested,
        seedUntil: Date.now() + SCHEDULED_SEED_MS,
      };
      scheduledNotices.set(draftId, notice);
      const threadId = options.threadId();
      let markedDone = false;
      const inInbox = options.threadInInbox
        ? options.threadInInbox() === true
        : true;
      if (threadId && inInbox) {
        try {
          await delivery.archive({ threadId, value: true }, inboxId);
          markedDone = true;
        } catch (error) {
          notices.reportError(error);
          notices.feedback.failure(
            'Email scheduled, but unable to mark thread done'
          );
        }
      }
      const result = action === 'update' ? 'updated' : 'scheduled';
      // Meanwhile a composer for the draft in another view may have cancelled
      // or rescheduled it, and the notice would announce a schedule that is
      // gone; or one may have seen it moved on another device. What this
      // composer observed meanwhile may be that change, so it reads the draft
      // afresh instead of ignoring it, and announces what it reads.
      let announced = requested;
      if (
        scheduledNotices.get(draftId) === notice &&
        sameTime(notice.sendTime, requested)
      ) {
        ignoredLifecycleObservation =
          deferredLifecycleObservation ?? options.lifecycleState?.();
      } else {
        ignoredLifecycleObservation = undefined;
        const fresh = await options.reconcile?.().catch(notices.reportError);
        if (scheduledNotices.get(draftId) !== notice) return result;
        if (fresh && fresh.type !== 'scheduled') return result;
        announced = fresh ? new Date(fresh.sendTime) : notice.sendTime;
      }
      try {
        // The title stays terse so it never truncates; the time is the subtext.
        let toastId: number | undefined;
        let undoStarted = false;
        const onViewScheduled = options.onViewScheduled;
        const viewAction = onViewScheduled
          ? [
              {
                label: 'View message',
                kind: 'open' as const,
                ...(action === 'schedule'
                  ? { variant: 'secondary' as const }
                  : {}),
                onClick: () => {
                  if (toastId != null) notices.feedback.dismiss(toastId);
                  onViewScheduled({
                    draftId,
                    threadId: threadId ?? undefined,
                    inboxId,
                  });
                },
              },
            ]
          : [];
        const undoAction =
          action === 'schedule'
            ? [
                {
                  label: 'Undo',
                  kind: 'undo' as const,
                  onClick: () => {
                    // A dismissing notice stays clickable; only the live one undoes.
                    if (undoStarted || scheduledNotices.get(draftId) !== notice)
                      return;
                    undoStarted = true;
                    scheduledNotices.delete(draftId);
                    if (toastId != null) notices.feedback.dismiss(toastId);
                    fireAndForget(
                      undoInitialSchedule({
                        draftId,
                        draftGeneration,
                        threadId: threadId ?? undefined,
                        inboxId,
                        sendTime: requested,
                        markedDone,
                      }),
                      'email-compose'
                    );
                  },
                },
              ]
            : [];
        const actions = [...viewAction, ...undoAction];
        toastId = notices.feedback.success(
          action === 'update' ? 'Email rescheduled' : 'Email scheduled',
          {
            subtext: `Sends ${format(
              announced,
              isThisYear(announced)
                ? "EEE, MMM d 'at' h:mm a"
                : "EEE, MMM d, yyyy 'at' h:mm a"
            )}`,
            ...(actions.length > 0 ? { actions, duration: 8_000 } : {}),
            // A composer mounted after the notice closes reads the draft afresh.
            onDismiss: () => {
              if (scheduledNotices.get(draftId) === notice)
                scheduledNotices.delete(draftId);
            },
          }
        );
        notice.toastId = toastId;
        // However long marking the thread done took, composers mounted while
        // the notice shows start from its schedule.
        notice.seedUntil = Date.now() + SCHEDULED_SEED_MS;
      } catch (error) {
        // Toast rendering is post-commit UI and cannot make a successful
        // schedule retryable.
        notices.reportError(error);
      }
      return result;
    } finally {
      setOperation('idle');
    }
  };

  const cancel = async (): Promise<boolean> => {
    const before = state();
    if (before.type !== 'scheduled' || pending()) return false;
    if (
      before.deliveryStatus === 'sending' ||
      before.deliveryStatus === 'unconfirmed'
    )
      return false;
    const draftId = options.draftId();
    if (!draftId) return false;
    const generation = options.generation();
    const inboxId = options.inboxId();
    deferredLifecycleObservation = undefined;
    setOperation('cancelling');
    try {
      try {
        await delivery.unschedule({
          draftGeneration: options.draftGeneration?.(),
          draftId,
          threadId: options.threadId() ?? undefined,
          inboxId,
        });
      } catch (error) {
        notices.reportError(error);
        try {
          const authoritative = await options.reconcile?.();
          if (authoritative?.type !== 'editing') {
            notices.feedback.failure('Failed to cancel schedule');
            return false;
          }
        } catch (refreshError) {
          notices.reportError(refreshError);
          notices.feedback.failure('Failed to cancel schedule');
          return false;
        }
      }
      if (
        generation !== options.generation() ||
        inboxId !== options.inboxId()
      ) {
        await options.reconcile?.().catch(notices.reportError);
        return false;
      }
      ignoredLifecycleObservation =
        deferredLifecycleObservation ?? options.lifecycleState?.();
      applyEditing();
      notices.feedback.success(
        'Schedule cancelled. This email is editable again.'
      );
      return true;
    } finally {
      setOperation('idle');
    }
  };

  const checkStatus = async () => {
    try {
      const next = await options.reconcile?.();
      if (next) observe(next);
    } catch (error) {
      notices.reportError(error);
      notices.feedback.failure(
        'Could not check delivery status. Try again when you have service.'
      );
    }
  };

  /** Preserve a proposed replacement as inert local intent after detaching. */
  const detach = () => {
    const current = state();
    if (current.type === 'editing') return;
    const proposed =
      current.type === 'scheduled' ? current.proposedTime : undefined;
    dismissScheduledNotice();
    selectionRevision += 1;
    setState(
      proposed
        ? { type: 'editing', intent: { type: 'later', sendTime: proposed } }
        : { type: 'editing', intent: { type: 'immediate' } }
    );
  };

  return {
    state,
    operation,
    pending,
    selectedTime,
    confirmedTime,
    action: () => getScheduleAction(state()),
    actionLabel: () => getScheduleActionLabel(state()),
    pickerDisabled: () => pending() || scheduleTimeLocked(state()),
    select,
    submit,
    cancel,
    checkStatus,
    observe,
    detach,
    reset: () => {
      scheduledDraftId = undefined;
      selectionRevision += 1;
      setState({ type: 'editing', intent: { type: 'immediate' } });
    },
  };
}
