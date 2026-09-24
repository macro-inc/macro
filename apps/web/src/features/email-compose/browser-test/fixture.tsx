import '@fontsource-variable/inter';
import '../../../index.css';
import { toast } from '@core/component/Toast/Toast';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import PaperclipIcon from '@phosphor/paperclip.svg';
import TextAa from '@phosphor/text-aa.svg';
import TrashIcon from '@phosphor/trash.svg';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import ArrowSquareOut from '@phosphor-icons/core/regular/arrow-square-out.svg?component-solid';
import { Button, SendButton } from '@ui';
import { format } from 'date-fns/format';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { EmailDateSelector } from '../components/email-date-selector';
import {
  EmailScheduleBar,
  EmailScheduleSummary,
} from '../components/email-schedule-summary';
import type { EmailScheduleState } from '../primitives/email-send-schedule';

type ScheduledItem = {
  id: string;
  subject: string;
  recipient: string;
  sendTime: Date;
};

function Fixture() {
  const params = new URLSearchParams(location.search);
  const mobile = params.has('mobile');
  const width = Number(params.get('width') ?? (mobile ? 360 : 520));
  const [view, setView] = createSignal<'compose' | 'scheduled'>('compose');
  const [schedule, setSchedule] = createSignal<EmailScheduleState>({
    type: 'editing',
    intent: { type: 'immediate' },
  });
  const [operation, setOperation] = createSignal<
    'idle' | 'committing' | 'updating' | 'cancelling'
  >('idle');
  const [scheduledItems, setScheduledItems] = createSignal<ScheduledItem[]>([]);
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
    return (
      operation() !== 'idle' ||
      (current.type === 'scheduled' && !current.proposedTime)
    );
  };

  const restoreDraft = () => {
    setScheduledItems((items) => items.filter((item) => item.id !== 'fixture'));
    setSchedule({ type: 'editing', intent: { type: 'immediate' } });
    setView('compose');
    toast.success('Schedule cancelled.');
  };

  const cancelSchedule = async () => {
    const current = schedule();
    if (current.type !== 'scheduled') return false;
    setOperation('cancelling');
    restoreDraft();
    setOperation('idle');
    return true;
  };

  const submit = () => {
    if (actionDisabled()) return;
    const current = schedule();
    setCommitCount((count) => count + 1);

    if (current.type === 'editing' && current.intent.type === 'immediate') {
      toast.success('Email sent', {
        actions: [
          { label: 'Undo', onClick: () => toast.success('Send undone') },
        ],
        duration: 5_000,
      });
      return;
    }

    const sendTime =
      current.type === 'editing' && current.intent.type === 'later'
        ? current.intent.sendTime
        : current.type === 'scheduled'
          ? current.proposedTime
          : undefined;
    if (!sendTime) return;

    setOperation(current.type === 'editing' ? 'committing' : 'updating');
    setSchedule({ type: 'scheduled', confirmedTime: sendTime });
    setScheduledItems([
      {
        id: 'fixture',
        subject: 'Quarterly notes',
        recipient: 'Peter',
        sendTime,
      },
    ]);
    setOperation('idle');
    // Mirrors the production notice in email-send-schedule.ts.
    let toastId: number | undefined;
    const dismissThen = (run: () => void) => () => {
      if (toastId != null) toast.dismiss(toastId);
      run();
    };
    toastId = toast.success('Email scheduled', {
      subtext: `Sends ${format(sendTime, "EEE, MMM d 'at' h:mm a")}`,
      actions: [
        {
          label: 'Undo',
          icon: ArrowCounterClockwise,
          onClick: dismissThen(restoreDraft),
        },
        {
          label: 'View message',
          icon: ArrowSquareOut,
          onClick: dismissThen(() => setView('compose')),
        },
      ],
      duration: 8_000,
    });
  };

  onMount(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
      event.preventDefault();
      submit();
    };
    window.addEventListener('keydown', handleShortcut);
    onCleanup(() => window.removeEventListener('keydown', handleShortcut));
  });

  document.documentElement.dataset.touchDevice = String(mobile);

  return (
    <main class="min-h-screen bg-surface p-4 text-ink">
      <div
        class="mx-auto flex flex-col"
        style={{ width: `min(${width}px, 100%)` }}
      >
        <div class="relative z-10 flex min-h-[380px] flex-col overflow-hidden rounded-2xl border border-edge-muted bg-surface-secondary shadow-xl">
          <nav
            class="flex border-b border-edge-muted p-2"
            aria-label="Email views"
          >
            <button
              class="rounded-lg px-3 py-2 text-sm data-[active=true]:bg-accent/15 data-[active=true]:text-accent"
              data-active={view() === 'compose'}
              onClick={() => setView('compose')}
            >
              Compose
            </button>
            <button
              class="rounded-lg px-3 py-2 text-sm data-[active=true]:bg-accent/15 data-[active=true]:text-accent"
              data-active={view() === 'scheduled'}
              onClick={() => setView('scheduled')}
            >
              Scheduled ({scheduledItems().length})
            </button>
          </nav>

          <Show
            when={view() === 'compose'}
            fallback={
              <section
                class="flex flex-1 flex-col p-4"
                aria-label="Scheduled emails"
              >
                <h1 class="mb-3 text-lg font-semibold">Scheduled</h1>
                <Show
                  when={scheduledItems().length}
                  fallback={
                    <p class="m-auto text-sm text-ink-muted">
                      No scheduled emails
                    </p>
                  }
                >
                  <div class="rounded-xl border border-edge-muted bg-surface p-3">
                    <div class="flex items-center gap-3">
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-sm font-medium">
                          To: {scheduledItems()[0].recipient}
                        </p>
                        <p class="truncate text-sm text-ink-muted">
                          {scheduledItems()[0].subject}
                        </p>
                      </div>
                      <time class="shrink-0 text-xs font-medium text-accent">
                        {format(scheduledItems()[0].sendTime, 'MMM d, h:mm a')}
                      </time>
                      <button
                        class="shrink-0 rounded-lg px-2 py-1.5 text-xs font-medium text-failure hover:bg-hover"
                        onClick={restoreDraft}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </Show>
              </section>
            }
          >
            <section
              class="flex flex-1 flex-col p-4"
              aria-label="Compose email"
            >
              <div class="border-b border-edge-muted py-2 text-sm">
                <span class="mr-2 text-ink-muted">From</span> me@macro.test
              </div>
              <div class="border-b border-edge-muted py-2 text-sm">
                <span class="mr-2 text-ink-muted">To</span> peter@example.test
              </div>
              <label class="border-b border-edge-muted py-2 text-sm">
                <span class="sr-only">Subject</span>
                <input
                  class="w-full bg-transparent outline-none"
                  value="Quarterly notes"
                />
              </label>
              <label class="flex flex-1 py-3 text-sm">
                <span class="sr-only">Message</span>
                <textarea
                  class="w-full resize-none bg-transparent outline-none"
                  placeholder="Write a message…"
                >
                  Here are the notes we discussed.
                </textarea>
              </label>

              <div
                data-testid="toolbar"
                class="flex min-w-0 flex-wrap items-center justify-end gap-y-1 border-t border-edge-muted pt-2"
              >
                <Show when={mobile}>
                  <EmailScheduleSummary
                    state={schedule()}
                    operation={operation()}
                    onSelectTime={selectTime}
                    onCancelSchedule={cancelSchedule}
                  />
                </Show>
                <div class="ml-auto flex shrink-0 items-center gap-1">
                  <Button label="Delete draft" size="icon-composer">
                    <TrashIcon />
                  </Button>
                  <Button label="Attach" size="icon-composer">
                    <PaperclipIcon />
                  </Button>
                  <Button label="Format" size="icon-composer">
                    <TextAa />
                  </Button>
                  <div class="shrink-0">
                    <EmailDateSelector
                      mobile={mobile}
                      compact
                      state={schedule()}
                      selectedTime={selectedTime()}
                      onSelectTime={selectTime}
                      onCancelSchedule={cancelSchedule}
                      operation={operation()}
                    />
                  </div>
                  <SendButton
                    appearance="composer"
                    disabled={actionDisabled()}
                    aria-label={actionLabel()}
                    tooltip={actionLabel()}
                    onClick={submit}
                    shortcut="cmd+enter"
                  />
                </div>
              </div>
            </section>
          </Show>
        </div>
        <Show when={!mobile && view() === 'compose'}>
          <EmailScheduleBar
            state={schedule()}
            operation={operation()}
            onSelectTime={selectTime}
            onCancelSchedule={cancelSchedule}
            class="-mt-6 rounded-b-[20px] border border-t-0 border-edge-muted px-4 pt-8 pb-2"
          />
        </Show>
      </div>

      <ToastRegion />
      <output class="sr-only" data-testid="commit-count">
        {commitCount()}
      </output>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(() => <Fixture />, root);
