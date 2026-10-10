import { createSignal } from 'solid-js';
import { EmailDateSelector } from '../components/email-date-selector';
import {
  EmailScheduleBar,
  EmailScheduleSummary,
} from '../components/email-schedule-summary';
import { createEmailSendSchedule } from '../primitives/email-send-schedule';

/** Real schedule controller and controls with an isolated provider-status fixture. */
export function ScheduleRecoveryFixture() {
  const params = new URLSearchParams(location.search);
  const status =
    (['pending', 'sending', 'failed', 'unconfirmed'] as const).find(
      (value) => value === params.get('status')
    ) ?? 'unconfirmed';
  const sendTime = new Date(Date.now() - 60_000);
  const [cancelCount, setCancelCount] = createSignal(0);
  const [checkCount, setCheckCount] = createSignal(0);
  const [sendCount, setSendCount] = createSignal(0);
  const [error, setError] = createSignal('');
  const schedule = createEmailSendSchedule({
    initialScheduledTime: sendTime,
    initialDeliveryStatus: status,
    draftId: () => 'recovery-draft',
    threadId: () => 'recovery-thread',
    inboxId: () => 'recovery-inbox',
    generation: () => 'one',
    includeSignature: () => undefined,
    saveDraft: async () => 'recovery-draft',
    delivery: {
      schedule: async () => {
        setSendCount((value) => value + 1);
      },
      unschedule: async () => {
        setCancelCount((value) => value + 1);
      },
      archive: async () => {},
    },
    notices: {
      feedback: {
        success: () => undefined,
        failure: (message) => {
          setError(message);
          return undefined;
        },
        alert: setError,
        dismiss: () => {},
      },
      reportError: () => {},
      blockingNotice: async () => {},
    },
    reconcile: async () => {
      setCheckCount((value) => value + 1);
      return {
        type: 'scheduled',
        draftId: 'recovery-draft',
        threadId: 'recovery-thread',
        inboxId: 'recovery-inbox',
        sendTime: sendTime.toISOString(),
        deliveryStatus: status,
        observedAt: Date.now(),
      };
    },
  });
  const Summary = params.has('mobile')
    ? EmailScheduleSummary
    : EmailScheduleBar;
  return (
    <main class="mx-auto flex max-w-xl flex-col gap-3 p-6 text-ink">
      <label>
        Message
        <textarea
          aria-label="Message"
          disabled={schedule.state().type === 'scheduled'}
        >
          Preserve this scheduled message
        </textarea>
      </label>
      <Summary
        state={schedule.state()}
        operation={schedule.operation()}
        onSelectTime={schedule.select}
        onCancelSchedule={schedule.cancel}
        onCheckStatus={schedule.checkStatus}
      />
      <EmailDateSelector
        state={schedule.state()}
        selectedTime={schedule.selectedTime()}
        mobile={params.has('mobile')}
        onSelectTime={schedule.select}
        onCancelSchedule={schedule.cancel}
        operation={schedule.operation()}
      />
      <button
        disabled={schedule.action() === 'unavailable'}
        onClick={() => void schedule.submit()}
      >
        Send email
      </button>
      <output data-testid="cancel-count">{cancelCount()}</output>
      <output data-testid="check-count">{checkCount()}</output>
      <output data-testid="send-count">{sendCount()}</output>
      <output role="alert">{error()}</output>
    </main>
  );
}
