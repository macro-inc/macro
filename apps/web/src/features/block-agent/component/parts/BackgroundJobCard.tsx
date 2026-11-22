import { t } from '@app/lib/i18n';
import DotsThree from '@icon/system/regular/dots-three.svg';
import type {
  ExecutionActivity,
  ExecutionStatus,
} from '@service-agent-harness/generated/schemas';
import { Button } from '@ui/components/Button';
import { Dropdown } from '@ui/components/Dropdown';
import { createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { ToolCard, type ToolStatus } from '../../ui';

/** What a background job's card shows, from its receipt and saved record. */
export type BackgroundJobView = {
  title: string;
  startedAt: string;
  /** The saved record's status, or the receipt's before the record loads. */
  status: ExecutionStatus;
  /** It settled before its program started, so nothing it would do ran. */
  neverRan?: boolean;
  activity: readonly ExecutionActivity[];
};

/** Minutes and seconds since `from`, e.g. `1:05`. */
export function elapsedLabel(from: string, now: number): string {
  const started = Date.parse(from);
  const seconds = Number.isNaN(started)
    ? 0
    : Math.max(0, Math.floor((now - started) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The trailing word a settled job's card ends with. */
export function jobOutcome(
  status: ExecutionStatus,
  neverRan = false
): string | undefined {
  if (neverRan && (status === 'timed_out' || status === 'interrupted'))
    return t('agentJobs.didNotRun');
  return match(status)
    .with('running', () => undefined)
    .with('succeeded', () => t('agentJobs.done'))
    .with('failed', () => t('agentJobs.failed'))
    .with('cancelled', () => t('agentJobs.cancelled'))
    .with('timed_out', () => t('agentJobs.timedOut'))
    .with('interrupted', () => t('agentJobs.interrupted'))
    .exhaustive();
}

/**
 * A cancel someone asked for is not a failure, and neither is a job that
 * timed out or was interrupted before it ran: they read muted, not red.
 */
function toolStatus(status: ExecutionStatus, neverRan = false): ToolStatus {
  if (neverRan && (status === 'timed_out' || status === 'interrupted'))
    return 'completed';
  return match(status)
    .with('running', () => 'running' as const)
    .with('succeeded', 'cancelled', () => 'completed' as const)
    .with('failed', 'timed_out', 'interrupted', () => 'failed' as const)
    .exhaustive();
}

/**
 * A program the agent left running in the background: its title, how long it
 * has run, its steps so far, and Cancel while it runs. It stays where the
 * agent started it and settles in place. On touch devices Cancel sits in the
 * card's overflow menu.
 */
export function BackgroundJobCard(props: {
  jobId: string;
  job: BackgroundJobView;
  /** Absent when the viewer can't stop it (no edit access, or it ended). */
  onCancel?: () => void;
  cancelling?: boolean;
  /** Cancel in an overflow menu instead of a button, for the mobile view. */
  cancelInMenu?: boolean;
}) {
  const running = () => props.job.status === 'running';
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => {
    if (running()) setNow(Date.now());
  }, 1000);
  onCleanup(() => clearInterval(timer));

  const trailing = (): JSX.Element => (
    <span class="flex items-center gap-1.5">
      <span>
        {running()
          ? elapsedLabel(props.job.startedAt, now())
          : jobOutcome(props.job.status, props.job.neverRan)}
      </span>
      <Show when={running() && props.onCancel}>
        {(cancel) => (
          <CancelControl
            onCancel={cancel()}
            busy={props.cancelling}
            inMenu={props.cancelInMenu}
          />
        )}
      </Show>
    </span>
  );

  return (
    <div
      class="flex min-w-0 flex-col"
      data-background-job={props.jobId}
      data-background-job-status={props.job.status}
    >
      <ToolCard
        title={props.job.title}
        subtitle={running() ? t('agentJobs.inBackground') : undefined}
        status={toolStatus(props.job.status, props.job.neverRan)}
        muted={!running() && props.job.status !== 'succeeded'}
        trailing={trailing()}
      />
      <For each={props.job.activity}>
        {(item) => (
          <div class="min-h-8 shrink-0 pl-3">
            <ToolCard
              title={item.label}
              status={
                item.status === 'failed'
                  ? 'failed'
                  : item.status === 'running' && running()
                    ? 'running'
                    : 'completed'
              }
              muted={item.status === 'unknown'}
              trailing={
                item.status === 'unknown'
                  ? t('agentJobs.outcomeUnknown')
                  : undefined
              }
            />
          </div>
        )}
      </For>
    </div>
  );
}

function CancelControl(props: {
  onCancel: () => void;
  busy?: boolean;
  inMenu?: boolean;
}) {
  return (
    <Show
      when={props.inMenu}
      fallback={
        <Button
          variant="secondary"
          size="xs"
          disabled={props.busy}
          onClick={(event: MouseEvent) => {
            event.stopPropagation();
            props.onCancel();
          }}
        >
          {t('agentJobs.cancel')}
        </Button>
      }
    >
      <Dropdown placement="bottom-end">
        <Dropdown.Trigger
          variant="ghost"
          size="icon-xs"
          aria-label={t('agentJobs.actions')}
        >
          <DotsThree class="size-4" />
        </Dropdown.Trigger>
        <Dropdown.Content>
          <Dropdown.Group>
            <Dropdown.Item disabled={props.busy} onSelect={props.onCancel}>
              <span>{t('agentJobs.cancelJob')}</span>
            </Dropdown.Item>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}
