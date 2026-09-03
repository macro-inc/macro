import { ENABLE_INBOX_SYNC_STATUS } from '@core/constant/featureFlags';
import ArrowsClockwiseIcon from '@phosphor-icons/core/regular/arrows-clockwise.svg?component-solid';
import {
  type BackfillProgress,
  estimateEtaSeconds,
  getBackfillProgress,
  useBackfillJobsQuery,
} from '@queries/email/backfill';
import {
  type BackfillJob,
  BackfillJobStatus,
  type Link as EmailLink,
  SyncStatus,
} from '@service-email/generated/schemas';
import { createMemo, Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';

function syncStatusLabel(status: SyncStatus): string {
  return match(status)
    .with(SyncStatus.SYNCING, () => 'Syncing…')
    .with(SyncStatus.UP_TO_DATE, () => 'Up to date')
    .with(SyncStatus.ERROR, () => 'Error — re-sync')
    .with(SyncStatus.NEEDS_REAUTH, () => 'Reconnect to resume sync')
    .with(SyncStatus.INACTIVE, () => 'Disabled')
    .exhaustive();
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `~${Math.max(1, Math.ceil(seconds))}s left`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `~${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `~${hours}h ${remMinutes}m left` : `~${hours}h left`;
}

function BackfillProgressBar(props: { progress: BackfillProgress }) {
  const percent = () => {
    if (props.progress.total <= 0) return 0;
    if (props.progress.completed >= props.progress.total) return 100;
    return Math.floor((props.progress.completed / props.progress.total) * 100);
  };
  const etaLabel = createMemo(() => {
    const seconds = estimateEtaSeconds(props.progress);
    return seconds === undefined ? undefined : formatEta(seconds);
  });
  return (
    <div class="flex w-60 flex-col gap-2">
      <span class="flex items-center gap-1.5 text-xs text-ink-muted">
        <ArrowsClockwiseIcon class="size-3 shrink-0 animate-spin" />
        Backfilling…
      </span>
      <div class="flex items-center gap-6 whitespace-nowrap text-xs text-ink-muted">
        <span>
          {props.progress.completed.toLocaleString()} of{' '}
          {props.progress.total.toLocaleString()} threads
        </span>
        <Show when={etaLabel()}>{(label) => <span>{label()}</span>}</Show>
      </div>
      <div class="h-1 w-full overflow-hidden rounded-full bg-edge-muted">
        <div
          class="h-full rounded-full bg-ink transition-[width] duration-300"
          style={{ width: `${percent()}%` }}
        />
      </div>
    </div>
  );
}

/** Dest inbox sync line: live backfill, initial-complete, or coarse status. */
export function InboxSyncStatus(props: { link: EmailLink }) {
  const backfillJobsQuery = useBackfillJobsQuery();
  const latestJob = (): BackfillJob | undefined => {
    for (const job of backfillJobsQuery.data?.jobs ?? []) {
      if (job.link_id === props.link.id) return job;
    }
    return undefined;
  };
  const hasCompletedBackfill = () =>
    latestJob()?.status === BackfillJobStatus.Complete;

  return (
    <Show when={ENABLE_INBOX_SYNC_STATUS}>
      <Switch
        fallback={
          <Show when={props.link.sync_status !== SyncStatus.UP_TO_DATE}>
            <span
              class="flex items-center gap-1 text-xs"
              classList={{
                'text-failure':
                  props.link.sync_status === SyncStatus.ERROR ||
                  props.link.sync_status === SyncStatus.NEEDS_REAUTH,
                'text-ink-muted':
                  props.link.sync_status !== SyncStatus.ERROR &&
                  props.link.sync_status !== SyncStatus.NEEDS_REAUTH,
              }}
            >
              <Show when={props.link.sync_status === SyncStatus.SYNCING}>
                <ArrowsClockwiseIcon class="size-3 animate-spin" />
              </Show>
              {syncStatusLabel(props.link.sync_status)}
            </span>
          </Show>
        }
      >
        <Match when={getBackfillProgress(props.link.id)}>
          {(progress) => <BackfillProgressBar progress={progress()} />}
        </Match>
        <Match
          when={
            props.link.sync_status === SyncStatus.UP_TO_DATE &&
            hasCompletedBackfill()
          }
        >
          <span class="text-xs text-ink-muted">Initial sync complete</span>
        </Match>
      </Switch>
    </Show>
  );
}
