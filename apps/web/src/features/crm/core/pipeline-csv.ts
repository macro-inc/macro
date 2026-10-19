import type { CellWrite } from '@core/database-sql/generated/types';
import { emailToMacroId, isMacroId, macroIdToEmail } from '@core/user/macroId';
import { err, ok, type Result } from 'neverthrow';
import { match } from 'ts-pattern';
import { cellValue } from '../../database/core/cell-ops';
import {
  type DatabaseCsv,
  encodeDatabaseCsv,
  exportedValue,
} from '../../database/core/csv';
import type {
  DatabaseCellValue,
  DatabaseViewColumn,
} from '../../database/core/database-view';
import { importedDomain, importedText } from './import-companies';
import type { Pipeline } from './pipeline';

/** The company or contact a pipeline row is for: its name, and its domain or email. */
export type PipelineCsvRecord = { name: string; key: string };

export type PipelineCsvRow = {
  cells: Record<string, DatabaseCellValue>;
};

/** A CSV row to add: the record it is for and the cells it starts with. */
type PipelineImportRow = {
  record: PipelineCsvRecord;
  cells: CellWrite[];
};

export type PipelineImportPlan = {
  rows: PipelineImportRow[];
  /** Pipeline columns the CSV fills. */
  columns: string[];
  /** CSV headers that match no column the import can write. */
  ignored: string[];
  /** Rows without a usable domain or email. */
  skipped: number;
  /** Values left empty because they do not fit their column. */
  invalidCells: number;
};

export type PipelineImportFailure =
  | { kind: 'no-record-column'; recordType: Pipeline['recordType'] }
  | { kind: 'no-rows' };

/** The record columns of a pipeline CSV, before the pipeline's own columns. */
export function pipelineRecordHeaders(
  recordType: Pipeline['recordType']
): [name: string, key: string] {
  return recordType === 'company'
    ? ['Company', 'Domain']
    : ['Contact', 'Email'];
}

const NAME_HEADERS = {
  company: ['company', 'name', 'company name'],
  contact: ['contact', 'name', 'contact name'],
};
const KEY_HEADERS = {
  company: ['domain', 'domains', 'website'],
  contact: ['email', 'email address'],
};
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const isPersonColumn = (column: DatabaseViewColumn) =>
  column.dataType === 'ENTITY' && column.specificEntityType === 'USER';

/** A grid value's entries: one for a single value, the list for a multi-valued cell. */
function entries(
  column: DatabaseViewColumn,
  value: DatabaseCellValue
): string[] {
  if (value === null || value === '') return [];
  if (!column.isMultiSelect) return [String(value)];
  try {
    const list: unknown = JSON.parse(String(value));
    return Array.isArray(list) ? list.map(String) : [String(value)];
  } catch {
    return [String(value)];
  }
}

/** People leave as emails, which other teams can match; other cells as a table export writes them. */
function exportedCell(column: DatabaseViewColumn, value: DatabaseCellValue) {
  return isPersonColumn(column)
    ? entries(column, value)
        .map((id) => (isMacroId(id) ? macroIdToEmail(id) : id))
        .join(', ')
    : exportedValue(column, value);
}

/** A pipeline as CSV: the record's name and key, then every other column. */
export function encodePipelineCsv(input: {
  recordType: Pipeline['recordType'];
  columns: readonly DatabaseViewColumn[];
  primaryColumnId: string;
  rows: readonly PipelineCsvRow[];
  record(id: string): PipelineCsvRecord | undefined;
}): string {
  const columns = input.columns.filter(
    (column) => column.id !== input.primaryColumnId
  );
  return encodeDatabaseCsv(
    [
      ...pipelineRecordHeaders(input.recordType),
      ...columns.map((column) => column.name),
    ],
    input.rows.map((row) => {
      const id = row.cells[input.primaryColumnId];
      const record = typeof id === 'string' ? input.record(id) : undefined;
      return [
        record?.name ?? '',
        record?.key ?? '',
        ...columns.map((column) =>
          exportedCell(column, row.cells[column.id] ?? null)
        ),
      ];
    })
  );
}

/**
 * Columns an import fills: writable, stored, and holding values that carry
 * across teams. References to records and other entities hold ids that a
 * different workspace would not have.
 */
function importable(column: DatabaseViewColumn, primaryColumnId: string) {
  return (
    column.id !== primaryColumnId &&
    column.writable &&
    !column.formula &&
    !column.relation &&
    (column.dataType !== 'ENTITY' || isPersonColumn(column))
  );
}

/** A date cell's stored instant, from a day or any date the browser reads. */
function importedDate(text: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const time = Date.parse(text);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/**
 * CSV text as the grid value `cellValue` writes, or undefined when it does
 * not fit the column. The service refuses a whole batch over one bad value,
 * so dates, links, and people are checked here.
 */
function gridValue(
  column: DatabaseViewColumn,
  text: string
): DatabaseCellValue | undefined {
  if (column.dataType === 'DATE') return importedDate(text);
  if (column.dataType === 'LINK')
    return /^https?:\/\/\S+$/i.test(text) ? text : undefined;
  if (!column.isMultiSelect && !isPersonColumn(column)) return text;
  const values = text
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) =>
      isPersonColumn(column) && !isMacroId(value)
        ? emailToMacroId(value.toLowerCase())
        : value
    );
  if (values.some((value) => value === undefined)) return undefined;
  return column.isMultiSelect ? JSON.stringify(values) : (values[0] ?? '');
}

function recordKey(recordType: Pipeline['recordType'], text: string) {
  if (recordType === 'company')
    return text
      .split(/[;,\s]+/)
      .map(importedDomain)
      .find((domain) => domain !== undefined);
  const email = text.toLowerCase();
  return EMAIL.test(email) ? email : undefined;
}

/**
 * The rows a CSV adds to a pipeline: each names its company by domain or its
 * contact by email, and fills the pipeline columns its other headers name.
 * A value that does not fit its column is left out rather than failing the row.
 */
export function planPipelineImport(
  csv: DatabaseCsv,
  pipeline: {
    recordType: Pipeline['recordType'];
    columns: readonly DatabaseViewColumn[];
    primaryColumnId: string;
  }
): Result<PipelineImportPlan, PipelineImportFailure> {
  const { recordType, primaryColumnId } = pipeline;
  const header = (names: string[]) =>
    csv.columns.findIndex((name) => names.includes(name.trim().toLowerCase()));
  const keyIndex = header(KEY_HEADERS[recordType]);
  if (keyIndex < 0) return err({ kind: 'no-record-column', recordType });
  const nameIndex = header(NAME_HEADERS[recordType]);
  const targets = csv.columns.map((name, index) =>
    index === keyIndex || index === nameIndex
      ? undefined
      : pipeline.columns.find(
          (column) =>
            importable(column, primaryColumnId) &&
            column.name.trim().toLowerCase() === name.trim().toLowerCase()
        )
  );
  let skipped = 0;
  let invalidCells = 0;
  const rows: PipelineImportRow[] = [];
  for (const values of csv.rows) {
    const key = recordKey(recordType, importedText(values[keyIndex]));
    if (!key) {
      skipped++;
      continue;
    }
    const cells: CellWrite[] = [];
    targets.forEach((column, index) => {
      const text = importedText(values[index]);
      if (!column || !text) return;
      const value = gridValue(column, text);
      if (value === undefined) {
        invalidCells++;
        return;
      }
      cellValue(column, value).match(
        (written) => cells.push({ column: column.id, value: written }),
        () => invalidCells++
      );
    });
    rows.push({
      record: {
        name: (nameIndex >= 0 && importedText(values[nameIndex])) || key,
        key,
      },
      cells,
    });
  }
  if (!rows.length) return err({ kind: 'no-rows' });
  return ok({
    rows,
    columns: targets.flatMap((column) => (column ? [column.name] : [])),
    ignored: csv.columns.filter(
      (_, index) => index !== keyIndex && index !== nameIndex && !targets[index]
    ),
    skipped,
    invalidCells,
  });
}

export function pipelineImportMessage(failure: PipelineImportFailure): string {
  return match(failure)
    .with(
      { kind: 'no-record-column', recordType: 'company' },
      () => 'Include a Domain column, with domains like acme.com.'
    )
    .with(
      { kind: 'no-record-column', recordType: 'contact' },
      () => 'Include an Email column, with addresses like jane@acme.com.'
    )
    .with({ kind: 'no-rows' }, () => 'No rows name a company or contact.')
    .exhaustive();
}

/** The cell naming the company or contact a new pipeline row is for. */
export function pipelineRecordCell(
  pipeline: Pick<Pipeline, 'recordType' | 'primaryColumnId'>,
  id: string
): CellWrite {
  return {
    column: pipeline.primaryColumnId,
    value: {
      type: 'entities',
      value: [
        {
          entityType: pipeline.recordType === 'company' ? 'COMPANY' : 'CONTACT',
          entityId: id,
        },
      ],
    },
  };
}

/** Company fields that pipeline rows hold now, rather than companies. */
const COMPANY_PIPELINE_FIELDS = ['stage', 'owner', 'revenue'];

/**
 * The part of a companies CSV that belongs on pipeline rows: the rows with a
 * Stage, Owner, or Revenue value, and which of those headers have one.
 * Undefined when no row has any.
 */
export function companyPipelineCsv(
  csv: DatabaseCsv
): { csv: DatabaseCsv; fields: string[] } | undefined {
  const fields = csv.columns.flatMap((name, index) =>
    COMPANY_PIPELINE_FIELDS.includes(name.trim().toLowerCase()) &&
    csv.rows.some((row) => importedText(row[index]))
      ? [index]
      : []
  );
  const rows = csv.rows.filter((row) =>
    fields.some((index) => importedText(row[index]))
  );
  if (!rows.length) return undefined;
  return {
    csv: { columns: csv.columns, rows },
    fields: fields.map((index) => csv.columns[index].trim()),
  };
}
