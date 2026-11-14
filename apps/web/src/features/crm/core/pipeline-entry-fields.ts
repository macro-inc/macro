import { match } from 'ts-pattern';
import { databaseCellValues } from '../../database/core/database-view';
import type { PipelineEntryCell } from './pipeline-entry';

/** Filled fields a collapsed card lists. */
export const COLLAPSED_FIELDS = 6;

/** Text this long, with a space in it, reads as a sentence rather than a value. */
const LONG_TEXT_CHARACTERS = 40;

/**
 * How far a card is open: its first filled fields, every filled field with
 * the empty ones folded into one row, or every field in column order.
 */
export type PipelineEntryFold = 'collapsed' | 'filled' | 'all';

/** How a value fits its row: one truncated line, two lines, or all of it. */
export type PipelineCellFit = 'line' | 'clamp' | 'full';

/** What a card lists for one fold. */
export type PipelineEntryFields = {
  /** The listed fields, in column order. */
  shown: PipelineEntryCell[];
  /** Empty fields folded into the row below the list. */
  folded: PipelineEntryCell[];
  /** How many fields "Show more" adds. */
  hidden: number;
  /** Whether long text is cut to two lines. */
  clamped: boolean;
};

/**
 * A field with no value, read as the grid cell shows one: missing or an empty
 * string. A checkbox always has one: unset reads as unchecked.
 */
export function isEmptyCell(cell: PipelineEntryCell): boolean {
  if (cell.column.dataType === 'BOOLEAN') return false;
  return databaseCellValues(cell.value, cell.column).every(
    (value) => value === null || value === ''
  );
}

/**
 * Text that reads as prose: several lines, or a sentence too long to sit
 * beside its label. Addresses and links have no spaces and stay on one line.
 */
export function isLongText(cell: PipelineEntryCell): boolean {
  if (
    cell.column.dataType !== 'STRING' ||
    cell.column.relation ||
    typeof cell.value !== 'string'
  )
    return false;
  const text = cell.value.trim();
  return (
    text.includes('\n') ||
    (text.length > LONG_TEXT_CHARACTERS && /\s/.test(text))
  );
}

/**
 * The fields a card lists: filled ones first, up to six while collapsed,
 * with the empty ones folded into one row until it is opened. `isEmpty` is
 * the card's settled reading, so a field cleared in place keeps its row.
 */
export function pipelineEntryFields(
  cells: PipelineEntryCell[],
  isEmpty: (cell: PipelineEntryCell) => boolean,
  fold: PipelineEntryFold
): PipelineEntryFields {
  const filled = cells.filter((cell) => !isEmpty(cell));
  const empty = cells.filter(isEmpty);
  const everyFilled = {
    shown: filled,
    folded: empty,
    hidden: 0,
    clamped: false,
  };
  return match(fold)
    .with('all', () => ({
      shown: cells,
      folded: [],
      hidden: 0,
      clamped: false,
    }))
    .with('filled', () => everyFilled)
    .with('collapsed', () => {
      // With every filled field in view there is nothing more to show.
      if (filled.length <= COLLAPSED_FIELDS) return everyFilled;
      return {
        shown: filled.slice(0, COLLAPSED_FIELDS),
        folded: [],
        hidden: cells.length - COLLAPSED_FIELDS,
        clamped: true,
      };
    })
    .exhaustive();
}

/** How a listed value fits its row. */
export function pipelineCellFit(
  cell: PipelineEntryCell,
  clamped: boolean
): PipelineCellFit {
  if (!isLongText(cell)) return 'line';
  return clamped ? 'clamp' : 'full';
}
