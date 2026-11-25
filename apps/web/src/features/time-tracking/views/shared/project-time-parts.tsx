import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { formatLocale, t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import ClockIcon from '@icon/system/regular/clock.svg';
import { Button, EmptyStatePanel } from '@ui';
import { For, type JSX } from 'solid-js';
import { match } from 'ts-pattern';
import { periodName } from '../../core/time-period';
import type {
  ExportOutcome,
  ProjectTime,
  ProjectTimeClock,
} from '../../primitives/create-project-time';

/** "Logged in November": the chosen period, as the total's label reads it. */
export function loggedInLabel(
  time: ProjectTime,
  clock: ProjectTimeClock
): string {
  return t('timeTracking.loggedIn', {
    period: periodName(
      time.period(),
      time.days(),
      clock.today(),
      formatLocale()
    ),
  });
}

/** Tells the person what an export left out or why it failed. */
export function reportExport(outcome: ExportOutcome): void {
  match(outcome)
    .with({ kind: 'failed' }, () =>
      toast.failure(t('timeTracking.exportFailed'))
    )
    .with({ kind: 'saved', complete: false }, ({ rows }) =>
      toast.alert(t('timeTracking.exportIncomplete', { count: rows }))
    )
    .otherwise(() => undefined);
}

/** Placeholder rows where a breakdown will appear. */
export function BreakdownSkeleton(): JSX.Element {
  return (
    <ListSkeleton.Root label={t('timeTracking.loadingEntries')}>
      <div class="flex flex-col gap-4 px-2 py-3">
        <For each={[0, 1, 2, 3]}>
          {() => (
            <div class="flex items-center gap-3">
              <ListSkeleton.Bar class="size-5 shrink-0 rounded-full" />
              <ListSkeleton.Bar class="h-3 w-2/5" />
              <ListSkeleton.Bar class="ml-auto h-3 w-14" />
            </div>
          )}
        </For>
      </div>
    </ListSkeleton.Root>
  );
}

export function SummaryFailed(props: { onRetry(): void }): JSX.Element {
  return (
    <div role="status" class="flex items-center gap-3 px-2 py-4 text-sm">
      <span class="text-ink-muted">{t('timeTracking.entriesFailed')}</span>
      <Button variant="secondary" size="sm" onClick={() => props.onRetry()}>
        {t('timeTracking.retry')}
      </Button>
    </div>
  );
}

export function NoTimeLogged(): JSX.Element {
  return (
    <EmptyStatePanel
      centered
      graphic={ClockIcon}
      graphicClass="size-10 text-ink-extra-muted"
      title={t('timeTracking.noTimeInPeriod')}
      description={t('timeTracking.noTimeInPeriodHint')}
      topSpacerClass="basis-0"
      class="py-10"
    />
  );
}

/** "Only part of the project is counted": the server read the first tasks only. */
export function SummaryIncomplete(): JSX.Element {
  return (
    <p role="status" class="text-sm text-ink-muted">
      {t('timeTracking.summaryIncomplete')}
    </p>
  );
}
