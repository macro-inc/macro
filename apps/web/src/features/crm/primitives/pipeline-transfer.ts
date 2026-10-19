import type { CellWrite } from '@core/database-sql/generated/types';
import { type Span, Telemetry } from '@macro-inc/observability';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import {
  databaseCsvMessage,
  MAX_CSV_BYTES,
  parseDatabaseCsv,
} from '../../database/core/csv';
import type { DatabaseViewColumn } from '../../database/core/database-view';
import type { PipelineTransfer } from '../context/pipelines';
import type { Pipeline } from '../core/pipeline';
import {
  encodePipelineCsv,
  type PipelineCsvRow,
  type PipelineImportPlan,
  pipelineImportMessage,
  pipelineRecordCell,
  planPipelineImport,
} from '../core/pipeline-csv';

type PipelineTable = { columns: DatabaseViewColumn[]; rows: PipelineCsvRow[] };

/** Ids of the records a pipeline's rows are for. */
function recordIds(pipeline: Pipeline, rows: readonly PipelineCsvRow[]) {
  return new Set(
    rows.flatMap((row) => {
      const id = row.cells[pipeline.primaryColumnId];
      return typeof id === 'string' && id ? [id] : [];
    })
  );
}

function pipelineCsvFilename(name: string, now: Date) {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'pipeline';
  return `macro-${slug}-${now.toISOString().slice(0, 10)}.csv`;
}

/** Every entry of the pipeline, with its company's or contact's name and key. */
export function createPipelineExport(
  pipeline: Accessor<Pipeline>,
  transfer: PipelineTransfer,
  download: (content: string, filename: string) => Promise<{ saved: boolean }>
) {
  const [pending, setPending] = createSignal(false);
  let controller: AbortController | undefined;
  onCleanup(() => controller?.abort());
  async function run(): Promise<'saved' | 'cancelled' | 'failed'> {
    if (pending()) return 'cancelled';
    setPending(true);
    controller = new AbortController();
    const signal = controller.signal;
    const span = Telemetry.span('crm.pipeline.export');
    span.setAttr('crm.pipeline_id', pipeline().id);
    try {
      const table = await span.span('crm.pipeline.read_table', () =>
        transfer.readTable(signal)
      );
      span.setAttr('crm.pipeline.rows', table.rows.length);
      const ids = [...recordIds(pipeline(), table.rows)];
      span.setAttr('crm.pipeline.records', ids.length);
      const records = await span.span('crm.pipeline.describe_records', () =>
        transfer.describeRecords(ids, signal)
      );
      const csv = encodePipelineCsv({
        recordType: pipeline().recordType,
        columns: table.columns,
        primaryColumnId: pipeline().primaryColumnId,
        rows: table.rows,
        record: (id) => records.get(id),
      });
      const { saved } = await download(
        `\uFEFF${csv}`,
        pipelineCsvFilename(pipeline().name, new Date())
      );
      span.setAttr('crm.export.saved', saved);
      return saved ? 'saved' : 'cancelled';
    } catch (cause) {
      span.error(cause);
      return 'failed';
    } finally {
      span.end();
      setPending(false);
    }
  }
  return { pending, run };
}

export type PipelineImportResult = {
  added: number;
  /** Records the pipeline already had a row for. */
  present: number;
  /** Records that could not be found or created, such as gmail.com companies. */
  unresolved: number;
};

/**
 * Adds a planned CSV's rows to a pipeline, creating the records the team
 * lacks. Rows for records the pipeline already has are skipped, so running
 * it again after a failure adds only what is still missing.
 */
export async function addPipelineRows(input: {
  span: Span;
  pipeline: Pipeline;
  transfer: PipelineTransfer;
  plan: PipelineImportPlan;
  table: PipelineTable;
  signal: AbortSignal;
  progress: (count: number) => void;
}): Promise<PipelineImportResult> {
  const { span, pipeline, transfer, plan, table } = input;
  const ids = await span.span('crm.pipeline.resolve_records', () =>
    transfer.resolveRecords(
      plan.rows.map((row) => row.record),
      input.signal,
      input.progress
    )
  );
  const present = recordIds(pipeline, table.rows);
  const rows: CellWrite[][] = [];
  const outcome: PipelineImportResult = { added: 0, present: 0, unresolved: 0 };
  for (const row of plan.rows) {
    const id = ids.get(row.record.key);
    if (!id) outcome.unresolved++;
    else if (present.has(id)) outcome.present++;
    else rows.push([pipelineRecordCell(pipeline, id), ...row.cells]);
  }
  await span.span('crm.pipeline.insert_rows', () =>
    transfer.insertRows(rows, table.columns)
  );
  outcome.added = rows.length;
  return outcome;
}

/**
 * A CSV's rows added to a pipeline. Records missing from the CRM are created;
 * a record already in the pipeline is not added again, so a retry after a
 * failure adds only what is still missing.
 */
export function createPipelineImport(
  pipeline: Pipeline,
  transfer: PipelineTransfer
) {
  const [plan, setPlan] = createSignal<PipelineImportPlan>();
  const [error, setError] = createSignal('');
  const [reading, setReading] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [resolved, setResolved] = createSignal(0);
  const [result, setResult] = createSignal<PipelineImportResult>();
  let controller: AbortController | undefined;
  onCleanup(() => controller?.abort());
  async function read(file?: Pick<File, 'size' | 'text'>) {
    setError('');
    setPlan(undefined);
    setResult(undefined);
    if (!file || reading() || pending()) return;
    if (file.size > MAX_CSV_BYTES) {
      setError(databaseCsvMessage({ kind: 'too-large' }));
      return;
    }
    setReading(true);
    controller = new AbortController();
    try {
      const csv = parseDatabaseCsv((await file.text()).replace(/^\uFEFF/, ''));
      if (csv.isErr()) {
        setError(databaseCsvMessage(csv.error));
        return;
      }
      const table = await transfer.readTable(controller.signal);
      planPipelineImport(csv.value, {
        recordType: pipeline.recordType,
        columns: table.columns,
        primaryColumnId: pipeline.primaryColumnId,
      }).match(setPlan, (failure) => setError(pipelineImportMessage(failure)));
    } catch {
      setError('Could not read this pipeline. Please try again.');
    } finally {
      setReading(false);
    }
  }
  async function run() {
    const current = plan();
    if (!current || pending()) return;
    setPending(true);
    setError('');
    setResolved(0);
    controller = new AbortController();
    const signal = controller.signal;
    const span = Telemetry.span('crm.pipeline.import');
    span.setAttr('crm.pipeline_id', pipeline.id);
    span.setAttr('crm.import.rows', current.rows.length);
    try {
      // Read again so a retry skips rows an interrupted import already added.
      const table = await span.span('crm.pipeline.read_table', () =>
        transfer.readTable(signal)
      );
      const outcome = await addPipelineRows({
        span,
        pipeline,
        transfer,
        plan: current,
        table,
        signal,
        progress: setResolved,
      });
      span.setAttr('crm.import.added', outcome.added);
      span.setAttr('crm.import.present', outcome.present);
      span.setAttr('crm.import.unresolved', outcome.unresolved);
      setResult(outcome);
      setPlan(undefined);
    } catch (cause) {
      span.error(cause);
      setError(
        'Could not finish the import. Retry to add the rows that are still missing.'
      );
    }
    try {
      await span.run(() => transfer.refresh());
    } catch (cause) {
      // The rows are saved; the pipeline's own polling shows them.
      span.event('refresh_failed', {
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
    span.end();
    setPending(false);
  }
  return { plan, error, reading, pending, resolved, result, read, run };
}
