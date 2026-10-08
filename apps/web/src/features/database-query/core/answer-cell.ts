import type { AnswerColumn, AnswerOption } from '@core/database-sql/answer';
import type { Cell, EntityKind } from '@core/database-sql/generated/types';
import { formatTime } from '@core/util/date';
import { markdownToPlainText } from '@macro-inc/lexical-core/utils/parsers';
import { formatDate } from '@property/utils/formatting';
import { match } from 'ts-pattern';
import type { DatabaseEntityType } from '../../database/core/column-inference';
import { formatQueryValue } from './query';

/** What one result value shows, drawn with the database grid's own pieces. */
export type ResultCell =
  | { kind: 'empty' }
  | { kind: 'text'; text: string }
  | { kind: 'markdown'; markdown: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; checked: boolean }
  | { kind: 'date'; date: Date; calendarDay: boolean }
  | { kind: 'options'; options: AnswerOption[]; tag: boolean }
  | { kind: 'mentions'; entityType: DatabaseEntityType; ids: string[] }
  /** Rows of another table, by id; `table` is theirs when it is known. */
  | { kind: 'rows'; ids: string[]; table: string | null }
  /** A `row_id`: one row of `table`, the table read, when it is known. */
  | { kind: 'row'; id: string; table: string | null };

/** A referenced entity's or related row's name, when it is known. */
export type ReferenceNames = (reference: {
  kind: EntityKind;
  id: string;
  table: string | null;
}) => string | undefined;

export const unknownNames: ReferenceNames = () => undefined;

const UNKNOWN_OPTION = 'Unknown option';

/** A result value as the grid would show it, from the column it was read from. */
export function resultCell(
  cell: Cell | null,
  column: AnswerColumn
): ResultCell {
  if (!cell) return { kind: 'empty' };
  const source = column.source;
  return match(cell)
    .returnType<ResultCell>()
    .with({ type: 'text' }, ({ value }) =>
      !value
        ? { kind: 'empty' }
        : source?.markdown
          ? { kind: 'markdown', markdown: value }
          : { kind: 'text', text: value }
    )
    .with({ type: 'number' }, ({ value }) => ({ kind: 'number', value }))
    .with({ type: 'bool' }, ({ value }) => ({
      kind: 'boolean',
      checked: value,
    }))
    .with({ type: 'date' }, ({ value }) => dateCell(value))
    .with({ type: 'options' }, ({ value }) =>
      value.length
        ? {
            kind: 'options',
            // An option deleted since the answer was read still shows that it was there.
            options: value.map(
              (id) =>
                source?.options.find((option) => option.id === id) ?? {
                  id,
                  label: UNKNOWN_OPTION,
                  color: null,
                }
            ),
            tag: source?.tag ?? false,
          }
        : { kind: 'empty' }
    )
    .with({ type: 'entities' }, ({ value }) => {
      const target = source?.target;
      if (!value.length) return { kind: 'empty' };
      if (target === 'DATABASE_ROW')
        return {
          kind: 'rows',
          ids: value,
          table: source?.relatedTable ?? null,
        };
      return target
        ? { kind: 'mentions', entityType: target, ids: value }
        : { kind: 'text', text: value.join(', ') };
    })
    .with({ type: 'row' }, ({ value }) => ({
      kind: 'row',
      id: value,
      table: source?.relatedTable ?? null,
    }))
    .exhaustive();
}

/**
 * A date cell as the moment it names. A calendar day, stored as UTC
 * midnight, is that day at local midnight so it reads as the same day.
 */
function dateCell(value: string): ResultCell {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { kind: 'text', text: value };
  const calendarDay =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
  return calendarDay
    ? {
        kind: 'date',
        date: new Date(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate()
        ),
        calendarDay,
      }
    : { kind: 'date', date, calendarDay };
}

/** A calendar day reads as the grid's date; a moment keeps its time. */
function formatResultDate(date: Date, calendarDay: boolean): string {
  return calendarDay
    ? formatDate(date)
    : `${formatDate(date)}, ${formatTime(date)}`;
}

/** A cell as plain text, for chart labels, titles and accessible names. */
export function resultCellText(
  cell: ResultCell,
  names: ReferenceNames = unknownNames
): string {
  return match(cell)
    .with({ kind: 'empty' }, () => '—')
    .with({ kind: 'text' }, ({ text }) => text)
    .with({ kind: 'markdown' }, ({ markdown }) => markdownToPlainText(markdown))
    .with({ kind: 'number' }, ({ value }) => formatQueryValue(value))
    .with({ kind: 'boolean' }, ({ checked }) => (checked ? 'True' : 'False'))
    .with({ kind: 'date' }, ({ date, calendarDay }) =>
      formatResultDate(date, calendarDay)
    )
    .with({ kind: 'options' }, ({ options }) =>
      options.map((option) => option.label).join(', ')
    )
    .with({ kind: 'mentions' }, ({ entityType, ids }) =>
      referenceList(
        entityType,
        ids.map((id) => names({ kind: entityType, id, table: null }))
      )
    )
    .with({ kind: 'rows' }, ({ ids, table }) =>
      referenceList(
        'DATABASE_ROW',
        ids.map((id) => names({ kind: 'DATABASE_ROW', id, table }))
      )
    )
    .with(
      { kind: 'row' },
      ({ id, table }) => names({ kind: 'DATABASE_ROW', id, table }) ?? id
    )
    .exhaustive();
}

const SHOWN_NAMES = 3;

/** Up to three names, then how many more; the count when no name is known. */
export function referenceList(
  type: DatabaseEntityType,
  names: (string | undefined)[]
): string {
  const known = names.filter((name): name is string => !!name);
  if (!known.length) return referenceCount(type, names.length);
  const shown = known.slice(0, SHOWN_NAMES);
  const more = names.length - shown.length;
  return more > 0 ? `${shown.join(', ')} +${more}` : shown.join(', ');
}

function referenceCount(type: DatabaseEntityType, count: number): string {
  const [one, many] = match(type)
    .with('USER', () => ['person', 'people'])
    .with('DOCUMENT', () => ['document', 'documents'])
    .with('TASK', () => ['task', 'tasks'])
    .with('CHANNEL', () => ['channel', 'channels'])
    .with('PROJECT', 'INITIATIVE', () => ['project', 'projects'])
    .with('CHAT', () => ['chat', 'chats'])
    .with('THREAD', () => ['email', 'emails'])
    .with('COMPANY', () => ['company', 'companies'])
    .with('CONTACT', () => ['contact', 'contacts'])
    .with('CALL_RECORD', () => ['call', 'calls'])
    .with('CALENDAR_EVENT', () => ['event', 'events'])
    .with('DATABASE_ROW', () => ['linked record', 'linked records'])
    .exhaustive();
  return `${count} ${count === 1 ? one : many}`;
}
