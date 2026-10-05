import { For } from 'solid-js';

// Matches SpreadsheetGrid at 100% zoom so the grid replaces this in place.
// Kept free of engine and document imports so loading states elsewhere can
// show it before the spreadsheet chunk arrives.
const DEFAULT_COLUMN_WIDTH = 100;
const ROW_HEIGHT = 21;
const COLUMN_HEADER_HEIGHT = 24;
const ROW_HEADER_WIDTH = 46;
const ROWS = Array.from({ length: 60 }, (_, index) => index);
const COLUMNS = Array.from({ length: 24 }, (_, index) => index);

/** The placeholder shape of a typical sheet: a title, a header row, labels in
 * the first column and right-aligned figures, with a few blank rows. */
function placeholder(row: number, column: number) {
  if (row === 0) return column === 0 ? { width: 70, start: true } : undefined;
  if (row === 1 || row > 22 || column > 6 || row % 7 === 0) return;
  const seed = (row * 37 + column * 101) % 11;
  if (row === 2) return { width: 45 + seed * 3, start: column === 0 };
  if (column === 0) return { width: 40 + seed * 4, start: true };
  return seed < 2 ? undefined : { width: 28 + seed * 3, start: false };
}

/** Loading state shaped like the grid, with a shimmer sweeping across it. */
export function SpreadsheetSkeleton(props: { label?: string }) {
  const label = () => props.label ?? 'Opening spreadsheet';
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label()}
      class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface opacity-100 transition-opacity duration-300 starting:opacity-0"
    >
      <span class="sr-only">{label()}…</span>
      <div
        class="flex shrink-0 bg-surface text-ink-muted select-none"
        style={{ height: `${COLUMN_HEADER_HEIGHT}px` }}
        aria-hidden="true"
      >
        <div
          class="shrink-0 border-b border-r border-edge"
          style={{ width: `${ROW_HEADER_WIDTH}px` }}
        />
        <For each={COLUMNS}>
          {(column) => (
            <div
              class="flex shrink-0 items-center justify-center border-b border-r border-edge-muted text-[11px] font-medium opacity-60"
              style={{ width: `${DEFAULT_COLUMN_WIDTH}px` }}
            >
              {String.fromCharCode(65 + column)}
            </div>
          )}
        </For>
      </div>
      <div class="skeleton-shimmer min-h-0 flex-1" aria-hidden="true">
        <For each={ROWS}>
          {(row) => (
            <div class="flex" style={{ height: `${ROW_HEIGHT}px` }}>
              <div
                class="flex shrink-0 items-center justify-center border-b border-r border-edge-muted bg-surface text-[11px] text-ink-muted opacity-60 select-none"
                style={{ width: `${ROW_HEADER_WIDTH}px` }}
              >
                {row + 1}
              </div>
              <For each={COLUMNS}>
                {(column) => {
                  const bar = placeholder(row, column);
                  return (
                    <div
                      class="flex shrink-0 items-center border-b border-r border-edge-muted px-1.5"
                      classList={{ 'justify-end': bar && !bar.start }}
                      style={{ width: `${DEFAULT_COLUMN_WIDTH}px` }}
                    >
                      {bar && (
                        <div
                          class="rounded-full bg-skeleton"
                          classList={{ 'h-2.5': row === 0, 'h-2': row > 0 }}
                          style={{ width: `${bar.width}%` }}
                        />
                      )}
                    </div>
                  );
                }}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
