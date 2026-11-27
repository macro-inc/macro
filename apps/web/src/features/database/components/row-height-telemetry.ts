import { Telemetry } from '@macro-inc/observability';

/** How a mounted row renders its cells when it is checked. */
export type RowRendering = 'preview' | 'link' | 'plain';

/** One mounted row: the height the virtualizer laid it out at, and the DOM's. */
export type RowHeightSample = {
  index: number;
  slotHeight: number;
  renderedHeight: number;
  /** Tallest cell content; above the rendered height, the row clips it. */
  contentHeight: number;
  rendering: RowRendering;
};

/** Everything a report may carry: numbers and enums, never cell content or ids. */
export type RowHeightMismatchReport = {
  samples: readonly RowHeightSample[];
  estimate: number;
  columnKinds: readonly string[];
  fontsLoaded: boolean;
  viewportWidth: number;
};

const TOLERANCE_PX = 1;
const MAX_REPORTS_PER_SESSION = 3;
const MIN_REPORT_INTERVAL_MS = 60_000;
/** Checks read layout, so a table checks at most this often. */
export const ROW_HEIGHT_CHECK_INTERVAL_MS = 10_000;

let reports = 0;
let lastReportAt = Number.NEGATIVE_INFINITY;

/** Whether this page session may still send a report. */
export function canReportRowHeightMismatch(now = performance.now()) {
  return (
    reports < MAX_REPORTS_PER_SESSION &&
    now - lastReportAt >= MIN_REPORT_INTERVAL_MS
  );
}

/** Test-only: forget the session's reports. */
export function resetRowHeightTelemetry() {
  reports = 0;
  lastReportAt = Number.NEGATIVE_INFINITY;
}

function isMismatched(sample: RowHeightSample) {
  return (
    Math.abs(sample.slotHeight - sample.renderedHeight) > TOLERANCE_PX ||
    sample.contentHeight > sample.renderedHeight + TOLERANCE_PX
  );
}

function bucket(value: number, bounds: readonly number[]) {
  const upper = bounds.find((bound) => value < bound);
  return upper === undefined ? `${bounds.at(-1)}+` : `<${upper}`;
}

/** Span attributes for a report; the test holds this to numbers and enums. */
export function rowHeightMismatchAttributes(
  report: RowHeightMismatchReport
): Record<string, string | number | boolean> | undefined {
  const mismatched = report.samples.filter(isMismatched);
  const first = mismatched[0];
  if (!first) return undefined;
  const count = (rendering: RowRendering) =>
    mismatched.filter((sample) => sample.rendering === rendering).length;
  return {
    'row_height.mounted_rows': report.samples.length,
    'row_height.mismatched_rows': mismatched.length,
    'row_height.mismatched_preview': count('preview'),
    'row_height.mismatched_link': count('link'),
    'row_height.mismatched_plain': count('plain'),
    'row_height.clipped_rows': mismatched.filter(
      (sample) => sample.contentHeight > sample.renderedHeight + TOLERANCE_PX
    ).length,
    'row_height.estimate': report.estimate,
    'row_height.slot': first.slotHeight,
    'row_height.rendered': first.renderedHeight,
    'row_height.content': first.contentHeight,
    'row_height.rendering': first.rendering,
    'row_height.index_bucket': bucket(first.index, [10, 50, 100, 500, 1000]),
    'row_height.column_kinds': [...new Set(report.columnKinds)]
      .sort()
      .join(','),
    'row_height.fonts_loaded': report.fontsLoaded,
    'row_height.viewport_bucket': bucket(
      report.viewportWidth,
      [480, 768, 1024, 1440, 1920]
    ),
  };
}

/**
 * Sends one `database.row_height_mismatch` span when any sampled row's
 * rendered height differs from its slot, at most a few times a session.
 * Anonymous: no user id, and only the numbers and enums above.
 */
export function reportRowHeightMismatch(
  report: RowHeightMismatchReport,
  now = performance.now()
) {
  if (!canReportRowHeightMismatch(now)) return false;
  const attributes = rowHeightMismatchAttributes(report);
  if (!attributes) return false;
  reports++;
  lastReportAt = now;
  const span = Telemetry.anonymousSpan('database.row_height_mismatch');
  for (const [key, value] of Object.entries(attributes))
    span.setAttr(key, value);
  span.end();
  return true;
}

/** Reads a mounted grid row's heights and how it renders, without its text. */
export function sampleRow(
  element: HTMLElement,
  index: number,
  slotHeight: number
): RowHeightSample {
  let contentHeight = 0;
  for (const cell of element.querySelectorAll<HTMLElement>('[role=gridcell]'))
    contentHeight = Math.max(contentHeight, cell.scrollHeight);
  return {
    index,
    slotHeight,
    renderedHeight: element.offsetHeight,
    contentHeight,
    rendering: element.hasAttribute('data-grid-preview')
      ? 'preview'
      : element.querySelector('a[href]')
        ? 'link'
        : 'plain',
  };
}
