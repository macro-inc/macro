import { formatCompactRelativeTimestamp } from '@entity/utils/timestamp';
import CheckCircle from '@phosphor/check-circle.svg';
import ClipboardText from '@phosphor/clipboard-text.svg';
import DownloadSimple from '@phosphor/download-simple.svg';
import Info from '@phosphor/info.svg';
import Plug from '@phosphor/plug.svg';
import type {
  ImportPlan,
  ImportSettlement,
  ReviewOutcome,
  SessionNotification,
} from '@service-agent-fold/generated/types';
import { Button } from '@ui/components/Button';
import { Tooltip } from '@ui/components/Tooltip';
import { Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';

function reviewSummary(
  payload: ReviewOutcome,
  settled: boolean,
  viewerId?: string
) {
  const total = payload.items.length;
  const failed = payload.items.filter((item) => !!item.error).length;
  const uncertain = payload.items.filter(
    (item) => item.status === 'unknown' && !item.error
  ).length;
  const completed = payload.items.filter(
    (item) => item.status === 'completed'
  ).length;
  const approved = payload.items.filter(
    (item) => item.status === 'completed' || item.status === 'submitting'
  ).length;
  const actor = payload.by === viewerId ? 'You' : 'Owner';
  const count = `${total} ${total === 1 ? 'item' : 'items'}`;
  let summary: string;
  if (payload.outcome === 'dismissed') {
    summary = `${actor} dismissed ${count}`;
  } else if (settled) {
    summary = `Review finished · ${completed} of ${count} completed`;
  } else if (payload.outcome === 'approved') {
    summary = `${actor} approved ${count}`;
  } else {
    summary = `${actor} approved ${approved} of ${count}`;
  }
  if (failed) summary += ` · ${failed} failed`;
  if (uncertain) summary += ` · ${uncertain} unconfirmed`;
  return { summary, failed: failed > 0 || uncertain > 0 };
}

function countLabel(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function importPlanSummary(plan: ImportPlan) {
  let summary = `Import plan ready · ${plan.copy} to copy`;
  if (plan.taskLists)
    summary += ` · ${countLabel(plan.taskLists, 'task list', 'task lists')}`;
  if (plan.byHand) summary += ` · ${plan.byHand} by hand`;
  return { summary, failed: false };
}

/** Counts only: an import report's error text can quote source content. */
function importSettlementSummary(report: ImportSettlement) {
  const heading = match(report.outcome)
    .with('completed', () => 'Import finished')
    .with('failed', () => 'Import failed')
    .with('cancelled', () => 'Import cancelled')
    .exhaustive();
  let summary = `${heading} · ${report.imported} of ${report.planned} imported`;
  if (report.failures.length) summary += ` · ${report.failures.length} failed`;
  if (report.handItems.length)
    summary += ` · ${report.handItems.length} by hand`;
  return {
    summary,
    failed: report.outcome === 'failed' || report.failures.length > 0,
  };
}

/** System facts stay on one line on desktop and mobile, outside messages. */
export function SessionEventRow(props: {
  event: SessionNotification;
  viewerId?: string;
  /** The host supplies navigation only when the subject can be opened. */
  onOpenReview?: (subjectId: string) => void;
}) {
  const display = () =>
    match(props.event)
      .with({ kind: 'app.connected' }, (event) => ({
        icon: Plug,
        summary: `${event.payload.app} connected`,
        failed: false,
        review: false,
      }))
      .with({ kind: 'review.decided' }, (event) => ({
        icon: ClipboardText,
        ...reviewSummary(event.payload, false, props.viewerId),
        review: true,
      }))
      .with({ kind: 'review.settled' }, (event) => ({
        icon: CheckCircle,
        ...('import' in event.payload
          ? importSettlementSummary(event.payload.import)
          : reviewSummary(event.payload, true, props.viewerId)),
        review: true,
      }))
      .with({ kind: 'import.planned' }, (event) => ({
        icon: DownloadSimple,
        ...importPlanSummary(event.payload),
        review: true,
      }))
      .exhaustive((_unknown) => ({
        icon: Info,
        summary: 'System event',
        failed: false,
        review: false,
      }));
  const exactTime = () => {
    const date = new Date(props.event.createdAt);
    return Number.isNaN(date.getTime())
      ? props.event.createdAt
      : date.toLocaleString(undefined, {
          dateStyle: 'full',
          timeStyle: 'long',
        });
  };
  return (
    <div
      role="status"
      class="flex min-w-0 items-center gap-2 py-1 text-xs"
      classList={{
        'text-failure': display().failed,
        'text-ink-muted': !display().failed,
      }}
    >
      <span aria-hidden="true" class="size-4 shrink-0 [&>svg]:size-4">
        <Dynamic component={display().icon} />
      </span>
      <span class="min-w-0 flex-1 truncate">
        <Tooltip label={display().summary} as="span" class="block truncate">
          <span>{display().summary}</span>
        </Tooltip>
      </span>
      <time
        class="shrink-0 text-ink-extra-muted"
        dateTime={props.event.createdAt}
        title={exactTime()}
      >
        {formatCompactRelativeTimestamp(props.event.createdAt)}
      </time>
      <Show when={display().review && props.onOpenReview}>
        {(open) => (
          <Button
            variant="ghost"
            size="xs"
            class="shrink-0"
            onClick={() => open()(props.event.subjectId)}
          >
            View review
          </Button>
        )}
      </Show>
    </div>
  );
}
