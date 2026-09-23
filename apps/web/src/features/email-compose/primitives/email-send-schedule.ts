import { format } from 'date-fns/format';
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
  | { type: 'scheduled'; confirmedTime: Date; proposedTime?: Date };

export type EmailScheduleAction =
  | 'send'
  | 'schedule'
  | 'update'
  | 'unavailable';

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

export function createEmailSendSchedule(options: {
  delivery: Pick<EmailDelivery, 'schedule' | 'unschedule' | 'archive'>;
  notices: EmailComposeFeedback;
  initialScheduledTime?: Date;
  draftId: Accessor<string | null | undefined>;
  saveDraft: () => Promise<string | undefined>;
  threadId: Accessor<string | null | undefined>;
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
}) {
  const { delivery, notices } = options;
  const [state, setState] = createSignal<EmailScheduleState>(
    options.initialScheduledTime
      ? {
          type: 'scheduled',
          confirmedTime: options.initialScheduledTime,
        }
      : { type: 'editing', intent: { type: 'immediate' } }
  );
  const [operation, setOperation] = createSignal<
    'idle' | 'committing' | 'updating' | 'cancelling'
  >('idle');
  let selectionRevision = 0;
  let ignoredLifecycleObservation: EmailDraftLifecycleState | undefined;
  let deferredLifecycleObservation: EmailDraftLifecycleState | undefined;

  const pending = () => operation() !== 'idle';
  const selectedTime = () => getScheduleSelection(state());
  const confirmedTime = () => {
    const current = state();
    return current.type === 'scheduled' ? current.confirmedTime : undefined;
  };

  /** Picker changes are deliberately local. They never mutate delivery state. */
  const select = (date: Date | null): boolean => {
    if (pending()) return false;
    selectionRevision += 1;
    setState((current) => {
      if (current.type === 'editing') {
        return date
          ? { type: 'editing', intent: { type: 'later', sendTime: date } }
          : { type: 'editing', intent: { type: 'immediate' } };
      }

      if (!date || sameTime(date, current.confirmedTime)) {
        return { type: 'scheduled', confirmedTime: current.confirmedTime };
      }
      return {
        type: 'scheduled',
        confirmedTime: current.confirmedTime,
        proposedTime: date,
      };
    });
    return true;
  };

  const applyScheduled = (sendTime: Date, replaceProposal = false) => {
    const current = state();
    if (
      !replaceProposal &&
      current.type === 'scheduled' &&
      sameTime(current.confirmedTime, sendTime) &&
      current.proposedTime
    ) {
      return;
    }
    selectionRevision += 1;
    setState({ type: 'scheduled', confirmedTime: sendTime });
  };

  const applyEditing = () => {
    if (state().type !== 'scheduled') return;
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
      applyScheduled(new Date(next.sendTime));
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
    threadId: string | undefined;
    inboxId: string | undefined;
    sendTime: Date;
  }) => {
    try {
      await delivery.unschedule({
        draftId: input.draftId,
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

      try {
        await delivery.schedule(
          {
            draftId,
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
      const threadId = options.threadId();
      if (threadId) {
        try {
          await delivery.archive({ threadId, value: true }, inboxId);
        } catch (error) {
          notices.reportError(error);
          notices.feedback.failure(
            'Email scheduled, but unable to mark thread done'
          );
        }
      }
      const successMessage = `Email ${action === 'update' ? 'rescheduled' : 'scheduled'} for ${format(requested, "MMM d, yyyy 'at' h:mm a")}`;
      try {
        if (action === 'schedule') {
          let undoStarted = false;
          const toastId = notices.feedback.success(successMessage, {
            actions: [
              {
                label: 'Undo',
                onClick: () => {
                  if (undoStarted) return;
                  undoStarted = true;
                  if (toastId != null) notices.feedback.dismiss(toastId);
                  void undoInitialSchedule({
                    draftId,
                    threadId: threadId ?? undefined,
                    inboxId,
                    sendTime: requested,
                  });
                },
              },
            ],
            duration: 5_000,
          });
        } else {
          notices.feedback.success(successMessage);
        }
      } catch (error) {
        // Toast rendering is post-commit UI and cannot make a successful
        // schedule retryable.
        notices.reportError(error);
      }
      ignoredLifecycleObservation =
        deferredLifecycleObservation ?? options.lifecycleState?.();
      return action === 'update' ? 'updated' : 'scheduled';
    } finally {
      setOperation('idle');
    }
  };

  const cancel = async (): Promise<boolean> => {
    const before = state();
    if (before.type !== 'scheduled' || pending()) return false;
    const draftId = options.draftId();
    if (!draftId) return false;
    const generation = options.generation();
    const inboxId = options.inboxId();
    deferredLifecycleObservation = undefined;
    setOperation('cancelling');
    try {
      try {
        await delivery.unschedule({ draftId, inboxId });
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

  /** Preserve a proposed replacement as inert local intent after detaching. */
  const detach = () => {
    const current = state();
    if (current.type === 'editing') return;
    const proposed =
      current.type === 'scheduled' ? current.proposedTime : undefined;
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
    select,
    submit,
    cancel,
    observe,
    detach,
    reset: () => {
      selectionRevision += 1;
      setState({ type: 'editing', intent: { type: 'immediate' } });
    },
  };
}
