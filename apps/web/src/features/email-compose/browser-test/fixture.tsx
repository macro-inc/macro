import '@fontsource-variable/inter';
import '../../../index.css';
import PaperclipIcon from '@phosphor/paperclip.svg';
import TextAa from '@phosphor/text-aa.svg';
import TrashIcon from '@phosphor/trash.svg';
import { Button, SendButton } from '@ui';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { EmailDateSelector } from '../components/email-date-selector';
import type { EmailScheduleState } from '../primitives/email-send-schedule';

const LONG_SCHEDULE_LABEL =
  'Wednesday, September 30, 2026 at 11:59 PM Coordinated Universal Time';

function Fixture() {
  const params = new URLSearchParams(location.search);
  const mobile = params.has('mobile');
  const flow = params.has('flow');
  const width = Number(params.get('width') ?? (mobile ? 240 : 420));
  const confirmedTime = new Date('2026-09-30T23:59:00Z');
  const [schedule, setSchedule] = createSignal<EmailScheduleState>(
    flow
      ? { type: 'editing', intent: { type: 'immediate' } }
      : { type: 'scheduled', confirmedTime }
  );
  const [commitCount, setCommitCount] = createSignal(0);
  const selectedTime = () => {
    const current = schedule();
    if (current.type === 'scheduled')
      return current.proposedTime ?? current.confirmedTime;
    return current.intent.type === 'later'
      ? current.intent.sendTime
      : undefined;
  };
  const selectTime = (date: Date | null) => {
    const current = schedule();
    if (current.type === 'scheduled') {
      setSchedule(
        date && date.getTime() !== current.confirmedTime.getTime()
          ? { ...current, proposedTime: date }
          : { type: 'scheduled', confirmedTime: current.confirmedTime }
      );
    } else {
      setSchedule(
        date
          ? { type: 'editing', intent: { type: 'later', sendTime: date } }
          : { type: 'editing', intent: { type: 'immediate' } }
      );
    }
    return true;
  };
  const actionLabel = () => {
    const current = schedule();
    if (current.type === 'scheduled')
      return current.proposedTime ? 'Update schedule' : 'Send email';
    return current.intent.type === 'later' ? 'Schedule send' : 'Send email';
  };
  const actionDisabled = () => {
    const current = schedule();
    return current.type === 'scheduled' && !current.proposedTime;
  };
  const status = () => {
    const current = schedule();
    if (current.type === 'scheduled')
      return `Scheduled for ${current.confirmedTime.toLocaleString()}`;
    return undefined;
  };
  const submit = () => {
    const current = schedule();
    if (current.type !== 'editing' || current.intent.type !== 'later') return;
    setCommitCount((count) => count + 1);
    setSchedule({
      type: 'scheduled',
      confirmedTime: current.intent.sendTime,
    });
  };
  document.documentElement.dataset.touchDevice = String(mobile);

  return (
    <main class="min-h-screen bg-surface p-4 text-ink">
      <div
        data-testid="toolbar"
        class="flex items-center justify-end gap-1 rounded-xl border border-edge-muted p-2"
        style={{ width: `${width}px` }}
      >
        <Button label="Delete draft" size="icon-composer">
          <TrashIcon />
        </Button>
        <Button label="Attach" size="icon-composer">
          <PaperclipIcon />
        </Button>
        <Button label="Format" size="icon-composer">
          <TextAa />
        </Button>
        <div class="min-w-0 max-w-[45%] shrink">
          <EmailDateSelector
            mobile={mobile}
            compact={mobile}
            state={schedule()}
            selectedTime={selectedTime()}
            onSelectTime={selectTime}
            operation="idle"
            trigger={
              mobile || flow
                ? undefined
                : () => (
                    <span class="min-w-0 truncate text-sm">
                      {LONG_SCHEDULE_LABEL}
                    </span>
                  )
            }
          />
        </div>
        <SendButton
          appearance="composer"
          disabled={actionDisabled()}
          aria-label={actionLabel()}
          actionLabel={actionDisabled() ? undefined : actionLabel()}
          tooltip={actionLabel()}
          onClick={submit}
        />
      </div>
      <Show when={status()}>
        {(label) => (
          <p role="status" data-testid="schedule-status">
            {label()}
          </p>
        )}
      </Show>
      <output data-testid="commit-count">{commitCount()}</output>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(() => <Fixture />, root);
