import { parseCsv } from '@core/util/csv';
import { type Span, Telemetry } from '@macro-inc/observability';
import { createSignal, onCleanup } from 'solid-js';
import type { DatabaseCsv } from '../../database/core/csv';
import type { CompanyImporter } from '../context/crm-sources';
import type { CompanyImportPipelines } from '../context/pipelines';
import {
  type CompanyImportRow,
  companyImportMessage,
  normalizeCompanyImport,
} from '../core/import-companies';
import type { Pipeline } from '../core/pipeline';
import { companyPipelineCsv, planPipelineImport } from '../core/pipeline-csv';
import { runConcurrently } from '../core/run-concurrently';
import {
  addPipelineRows,
  type PipelineImportResult,
} from './pipeline-transfer';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
/** Concurrent creates: fast enough for thousands of rows, gentle on the service. */
const IMPORT_CONCURRENCY = 4;
const MAX_PIPELINE_NAME = 200;

/** Where the import puts Stage, Owner, and Revenue. */
export type ImportDestination =
  | { kind: 'new'; sharing: Pipeline['sharing'] }
  | { kind: 'existing'; id: string };

/** A pipeline named after the imported file. */
function importedPipelineName(fileName: string) {
  return (
    fileName
      .replace(/\.csv$/i, '')
      .trim()
      .slice(0, MAX_PIPELINE_NAME) || 'Imported companies'
  );
}

/**
 * Companies from a CSV. Stage, Owner, and Revenue now live on pipeline rows,
 * so when the file has them they go into a pipeline the viewer picks: a new
 * one, private or shared with the team, or an existing company pipeline, one
 * row per
 * company that has a value. Running again reuses that pipeline and adds only
 * the rows it lacks.
 */
export function createCompanyImport(
  importer: CompanyImporter,
  pipelines?: CompanyImportPipelines
) {
  const [rows, setRows] = createSignal<CompanyImportRow[]>([]);
  const [skipped, setSkipped] = createSignal(0);
  const [error, setError] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [completed, setCompleted] = createSignal(0);
  const [existing, setExisting] = createSignal(0);
  const [pipelineData, setPipelineData] = createSignal<{
    csv: DatabaseCsv;
    fields: string[];
    name: string;
  }>();
  const [pipeline, setPipeline] = createSignal<
    { pipeline: Pipeline } & PipelineImportResult
  >();
  const [destination, setDestinationSignal] = createSignal<ImportDestination>({
    kind: 'new',
    sharing: 'private',
  });
  let target: Pipeline | undefined;
  /** A new choice applies to the next run, so a pipeline made earlier is forgotten. */
  const setDestination = (next: ImportDestination) => {
    target = undefined;
    setPipeline(undefined);
    setDestinationSignal(next);
  };
  const targetPipeline = async (span: Span, name: string) => {
    const chosen = destination();
    if (chosen.kind === 'existing') {
      const existing = pipelines
        ?.existing()
        .find((pipeline) => pipeline.id === chosen.id);
      if (!existing) throw new Error('The chosen pipeline is unavailable.');
      return existing;
    }
    return span.span('crm.companies.import.create_pipeline', async () => {
      if (!pipelines) throw new Error('Pipelines are unavailable.');
      return pipelines.create(name, chosen.sharing);
    });
  };
  let controller: AbortController | undefined;
  onCleanup(() => controller?.abort());
  /** Whether running again has anything left to do. */
  const runnable = () =>
    rows().length > 0 || (!!pipelines && !!pipelineData() && !pipeline());
  async function read(file?: Pick<File, 'name' | 'size' | 'text'>) {
    setError('');
    setRows([]);
    setSkipped(0);
    setCompleted(0);
    setExisting(0);
    setPipelineData(undefined);
    setPipeline(undefined);
    target = undefined;
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setError('Choose a CSV smaller than 5 MB.');
      return;
    }
    try {
      const parsed = parseCsv((await file.text()).replace(/^\uFEFF/, ''));
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      const normalized = normalizeCompanyImport(parsed.records);
      if (normalized.isErr()) {
        setError(companyImportMessage(normalized.error));
        return;
      }
      setRows(normalized.value.rows);
      setSkipped(normalized.value.skipped);
      const columns = [...parsed.headers];
      const fields = companyPipelineCsv({
        columns,
        rows: parsed.records.map((record) =>
          columns.map((column) => record[column] ?? '')
        ),
      });
      if (fields)
        setPipelineData({ ...fields, name: importedPipelineName(file.name) });
    } catch {
      setError('Could not read that file. Please try again.');
    }
  }
  async function importRow(row: CompanyImportRow) {
    try {
      const outcome = await importer.create(row);
      if (outcome === 'exists') setExisting((n) => n + 1);
      else setCompleted((n) => n + 1);
      return true;
    } catch {
      return false;
    }
  }
  /** Stage, Owner, and Revenue as rows of the import's pipeline. */
  async function importPipeline(span: Span, signal: AbortSignal) {
    const data = pipelineData();
    if (!pipelines || !data) return true;
    try {
      target ??= await targetPipeline(span, data.name);
      span.setAttr('crm.pipeline_id', target.id);
      const transfer = pipelines.transfer(target);
      const table = await span.span('crm.pipeline.read_table', () =>
        transfer.readTable(signal)
      );
      const plan = planPipelineImport(data.csv, {
        recordType: target.recordType,
        columns: table.columns,
        primaryColumnId: target.primaryColumnId,
      });
      // The companies import already found a domain column and rows.
      if (plan.isErr()) return false;
      const result = await addPipelineRows({
        span,
        pipeline: target,
        transfer,
        plan: plan.value,
        table,
        signal,
        progress: () => {},
      });
      span.setAttr('crm.import.pipeline_rows', result.added);
      setPipeline({ pipeline: target, ...result });
      try {
        await transfer.refresh();
      } catch {
        // The rows are saved; the pipeline's own polling shows them.
      }
      return true;
    } catch (cause) {
      span.error(cause);
      return false;
    }
  }
  async function run() {
    if (pending() || !runnable()) return;
    setPending(true);
    setError('');
    controller = new AbortController();
    const signal = controller.signal;
    const failed = new Set<CompanyImportRow>();
    const pipelineSaved = await Telemetry.span(
      'crm.companies.import',
      async (span) => {
        span.setAttr('crm.import.rows', rows().length);
        await span.span('crm.companies.import.create', () =>
          runConcurrently(rows(), IMPORT_CONCURRENCY, async (row) => {
            if (!(await importRow(row))) failed.add(row);
          })
        );
        span.setAttr('crm.import.created', completed());
        span.setAttr('crm.import.existing', existing());
        span.setAttr('crm.import.failed', failed.size);
        const saved = await importPipeline(span, signal);
        try {
          await importer.refresh();
        } catch (cause) {
          // The companies exist; listings catch up on their next read.
          span.event('refresh_failed', {
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
        return saved;
      }
    );
    setRows((all) => all.filter((row) => failed.has(row)));
    setPending(false);
    const messages = [
      failed.size
        ? `${failed.size} could not be imported. They may use an unsupported domain, such as gmail.com. Successful rows will not be retried.`
        : '',
      pipelineSaved
        ? ''
        : `Could not add ${pipelineData()?.fields.join(', ')} to the pipeline. Import again to retry.`,
    ];
    setError(messages.filter(Boolean).join(' '));
  }
  return {
    rows,
    skipped,
    error,
    pending,
    completed,
    existing,
    pipelineData,
    pipeline,
    destination,
    setDestination,
    runnable,
    read,
    run,
  };
}
