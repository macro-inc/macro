import {
  type BackfillProgress,
  estimateEtaSeconds,
  getBackfillProgress,
} from '@queries/email/backfill';
import { useEmailLinksQuery } from '@queries/email/link';
import ArrowsClockwiseIcon from '@phosphor-icons/core/regular/arrows-clockwise.svg?component-solid';
import { createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { NotificationTriageExperiment } from './notification-triage-experiment';

// TEMP PREVIEW: set to true to render an animated fake import for design review.
// Remove this flag (and the preview block in HomeStatusSection) before shipping.
const BACKFILL_PREVIEW = true;

// Reveal triage once this fraction of the backfill is done. The first-pass
// "signal" backfill lands the most important threads in the first ~5-10%, which
// is enough for triage to be useful — so we don't wait for the full import.
const SHOW_TRIAGE_AT = 0.1;

/** Bin the ETA into s / m / h so it doesn't jitter between progress events. */
function formatEta(seconds: number): string {
  if (seconds < 60) return `~${Math.max(1, Math.ceil(seconds))}s left`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `~${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `~${hours}h ${rem}m left` : `~${hours}h left`;
}

/**
 * The home status slot: shows the inbox-import card only during the early phase
 * of a backfill, then hands the slot to triage once past {@link SHOW_TRIAGE_AT}
 * (the import keeps running in the background). Falls straight through to triage
 * when nothing is importing.
 */
export function HomeStatusSection() {
  const linksQuery = useEmailLinksQuery();

  // TEMP PREVIEW: a fake backfill that climbs through the threshold so both the
  // import card and the hand-off to triage can be reviewed.
  const [preview, setPreview] = createSignal<BackfillProgress>({
    completed: 24,
    total: 840,
    samples: [{ at: Date.now(), completed: 24 }],
  });
  if (BACKFILL_PREVIEW) {
    const timer = setInterval(() => {
      setPreview((p) => {
        if (p.completed >= 210) {
          return {
            completed: 24,
            total: 840,
            samples: [{ at: Date.now(), completed: 24 }],
          };
        }
        const completed = p.completed + 8;
        const samples = [...p.samples, { at: Date.now(), completed }].slice(-5);
        return { ...p, completed, samples };
      });
    }, 600);
    onCleanup(() => clearInterval(timer));
  }

  // Reactive: getBackfillProgress reads the live progress signal.
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

  const fraction = () => {
    const { completed, total } = totals();
    return total > 0 ? completed / total : 0;
  };

  // Show the import card only early on; otherwise the slot belongs to triage.
  const showImport = () => active().length > 0 && fraction() < SHOW_TRIAGE_AT;

  const percent = () => Math.floor(fraction() * 100);

  const title = () => {
    const n = active().length;
    return n === 1 ? 'Importing your inbox' : `Importing ${n} inboxes`;
  };

  const detail = () => {
    const entries = active();
    const { completed, total } = totals();
    const counts = `${completed.toLocaleString()} of ${total.toLocaleString()}`;
    if (entries.length !== 1) return counts;
    const seconds = estimateEtaSeconds(entries[0]);
    return seconds === undefined ? counts : `${counts} · ${formatEta(seconds)}`;
  };

  // Triage stays mounted underneath (loads once, defines a stable height); the
  // import card is a crossfading overlay on top. Swapping never changes the
  // slot height, so nothing above it gets displaced.
  return (
    <div class="relative mx-auto min-h-20 w-full max-w-3xl">
      <NotificationTriageExperiment />
      <div
        aria-hidden={!showImport()}
        class={`absolute inset-0 bg-surface transition-opacity duration-300 ${
          showImport() ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <Show when={active().length > 0}>
          <div class="w-full rounded-xl border border-edge-muted bg-active p-3">
            <div class="flex items-center justify-between gap-3">
              <div class="flex min-w-0 items-center gap-2">
                <ArrowsClockwiseIcon class="size-3.5 shrink-0 animate-spin text-ink-muted" />
                <span class="truncate text-sm text-ink">{title()}</span>
              </div>
              <span class="shrink-0 text-xs tabular-nums text-ink-muted">
                {detail()}
              </span>
            </div>
            <div class="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-edge-muted">
              <div
                class="h-full rounded-full bg-ink transition-[width] duration-500 ease-out"
                style={{ width: `${percent()}%` }}
              />
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
