import {
  type BackfillProgress,
  getBackfillProgress,
} from '@queries/email/backfill';
import { useEmailLinksQuery } from '@queries/email/link';
import ArrowsClockwiseIcon from '@phosphor-icons/core/regular/arrows-clockwise.svg?component-solid';
import { createMemo, createSignal, onCleanup, Show } from 'solid-js';

// TEMP PREVIEW: set to true to render an animated fake import for design review.
// Remove this flag (and the preview block below) before shipping.
const BACKFILL_PREVIEW = true;

/**
 * Slim inbox-import line for the home header. Shows a spinner, label, a thin
 * progress bar, and the count while one or more connected inboxes are
 * backfilling. Renders nothing when nothing is importing.
 */
export function HomeBackfillProgress() {
  const linksQuery = useEmailLinksQuery();

  // TEMP PREVIEW: animated fake progress so the importing state can be reviewed.
  const [preview, setPreview] = createSignal<BackfillProgress>({
    completed: 480,
    total: 840,
    samples: [],
  });
  if (BACKFILL_PREVIEW) {
    const timer = setInterval(() => {
      setPreview((p) => ({
        ...p,
        completed: p.completed >= p.total ? 480 : p.completed + 8,
      }));
    }, 700);
    onCleanup(() => clearInterval(timer));
  }

  const active = createMemo<BackfillProgress[]>(() => {
    if (BACKFILL_PREVIEW) return [preview()];
    return (linksQuery.data?.links ?? [])
      .map((link) => getBackfillProgress(link.id))
      .filter((p): p is BackfillProgress => p !== undefined && p.total > 0);
  });

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
    <Show when={active().length > 0}>
      <div class="rounded-xl border border-edge-muted bg-active p-4">
        <div class="flex items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <ArrowsClockwiseIcon class="size-3.5 shrink-0 animate-spin text-ink-muted" />
            <span class="text-sm text-ink">Importing your inbox</span>
          </div>
          <span class="shrink-0 text-xs tabular-nums text-ink-muted">
            {totals().completed.toLocaleString()} /{' '}
            {totals().total.toLocaleString()}
          </span>
        </div>
        <div class="mt-3 h-1 w-full overflow-hidden rounded-full bg-edge-muted">
          <div
            class="h-full rounded-full bg-ink transition-[width] duration-500 ease-out"
            style={{ width: `${percent()}%` }}
          />
        </div>
      </div>
    </Show>
  );
}
