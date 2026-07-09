import ArrowsClockwiseIcon from '@phosphor-icons/core/regular/arrows-clockwise.svg?component-solid';
import {
  type BackfillProgress,
  getBackfillProgress,
} from '@queries/email/backfill';
import { useEmailLinksQuery } from '@queries/email/link';
import { SyncStatus } from '@service-email/generated/schemas';
import { createMemo, Match, Show, Switch } from 'solid-js';

/**
 * Slim inbox-import line for the home header. Shows a spinner, label, a thin
 * progress bar, and the count while one or more connected inboxes are
 * backfilling. Renders nothing when nothing is importing.
 */
export function HomeBackfillProgress() {
  const linksQuery = useEmailLinksQuery();

  const active = createMemo<BackfillProgress[]>(() =>
    (linksQuery.data?.links ?? [])
      .map((link) => getBackfillProgress(link.id))
      .filter((p): p is BackfillProgress => p !== undefined && p.total > 0)
  );

  const isImporting = createMemo(() =>
    (linksQuery.data?.links ?? []).some(
      (link) => link.sync_status === SyncStatus.SYNCING
    )
  );

  const totals = createMemo(() => {
    const entries = active();
    return {
      completed: entries.reduce((sum, p) => sum + p.completed, 0),
      total: entries.reduce((sum, p) => sum + p.total, 0),
    };
  });

  const percent = () => {
    const { completed, total } = totals();
    if (total <= 0) return 0;
    if (completed >= total) return 100;
    return Math.floor((completed / total) * 100);
  };

  return (
    <Show when={active().length > 0 || isImporting()}>
      <div class="rounded-xl border border-edge-muted bg-active p-4">
        <div class="flex items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <ArrowsClockwiseIcon class="size-3.5 shrink-0 animate-spin text-ink-muted" />
            <span class="text-sm text-ink">Importing your inbox</span>
          </div>
          <Show when={active().length > 0}>
            <span class="shrink-0 text-xs tabular-nums text-ink-muted">
              {totals().completed.toLocaleString()} /{' '}
              {totals().total.toLocaleString()}
            </span>
          </Show>
        </div>
        <div class="mt-3 h-1 w-full overflow-hidden rounded-full bg-edge-muted">
          <Switch>
            <Match when={active().length > 0}>
              <div
                class="h-full rounded-full bg-ink transition-[width] duration-500 ease-out"
                style={{ width: `${percent()}%` }}
              />
            </Match>
            <Match when={isImporting()}>
              <div class="h-full w-1/3 animate-pulse rounded-full bg-ink-muted" />
            </Match>
          </Switch>
        </div>
      </div>
    </Show>
  );
}
