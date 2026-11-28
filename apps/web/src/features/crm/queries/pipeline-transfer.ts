import type { CellValue, DatabaseOp } from '@core/database-sql/generated/types';
import {
  catchToResult,
  ThrownResultError,
  throwOnErr,
} from '@core/util/result';
import { soupKeys } from '@queries/soup/keys';
import type { CrmPipelineImportCellValue } from '@service-storage/graphql/generated/graphql';
import {
  createGraphqlCrmCompany,
  createGraphqlCrmContact,
} from '@service-storage/graphql-crm-create';
import { insertGraphqlCrmPipelineRows } from '@service-storage/graphql-crm-edits';
import { v7 as uuidv7 } from 'uuid';
import { missingOptionLabels } from '../../database/core/cell-ops';
import type { PipelineTransfer } from '../context/pipelines';
import { importedDomain } from '../core/import-companies';
import type { Pipeline } from '../core/pipeline';
import {
  type PipelineCsvRecord,
  PipelineImportRefusal,
} from '../core/pipeline-csv';
import { runConcurrently } from '../core/run-concurrently';
import { refreshCrmCreateLists } from './create-refresh';
import type { CrmCreateDependencies } from './dependencies';
import { fetchCrmExportCompanies } from './export';
import { crmKeys } from './keys';
import { pipelineCell, pipelineViewColumn } from './pipeline-data';

const CONCURRENCY = 4;
/** Bound both the write and post-commit row read. */
const INSERT_BATCH = 500;

function importCellValue(cell: CellValue): CrmPipelineImportCellValue | null {
  switch (cell.type) {
    case 'text':
      return { text: cell.value };
    case 'number':
      return { number: cell.value };
    case 'boolean':
      return { boolean: cell.value };
    case 'date':
      return { date: cell.value };
    case 'date_range':
      return { dateRange: cell.value };
    case 'link':
      return { links: cell.value };
    case 'options':
      return {
        options: cell.value.map((option) =>
          option.id !== undefined ? { id: option.id } : { label: option.label }
        ),
      };
    case 'entities':
      return { entities: cell.value };
    case 'rows':
      return { rowIds: cell.value };
    case 'clear':
      return null;
  }
}

/** Bulk reads and writes of one pipeline, over its own routes. */
export function createPipelineTransfer(
  deps: CrmCreateDependencies,
  pipeline: Pipeline
): PipelineTransfer {
  const { storage } = deps;
  const companies = (signal: AbortSignal) =>
    fetchCrmExportCompanies(signal, () => {});
  /**
   * The company for a domain, created when the team lacks it. Contacts at one
   * new domain share a single creation rather than racing to a conflict.
   */
  function companyId(
    domains: Map<string, Promise<string | undefined>>,
    record: PipelineCsvRecord,
    domain: string
  ) {
    const known = domains.get(domain);
    if (known) return known;
    const created = (async () => {
      const company = await catchToResult(() =>
        createGraphqlCrmCompany({ name: record.name, domain }, 'batch')
      );
      return company.isOk() ? company.value.id : undefined;
    })();
    domains.set(domain, created);
    return created;
  }
  async function contactId(
    domains: Map<string, Promise<string | undefined>>,
    record: PipelineCsvRecord
  ) {
    const found = await storage.getContactByEmail({ email: record.key });
    // A failed lookup is not a missing contact; creating one could duplicate it.
    if (found.isErr()) return undefined;
    if (found.value.contact) return found.value.contact.id;
    const domain = importedDomain(record.key);
    if (!domain) return undefined;
    const company = await companyId(
      domains,
      { name: domain, key: domain },
      domain
    );
    if (!company) return undefined;
    const created = await catchToResult(() =>
      createGraphqlCrmContact(
        { companyId: company, name: record.name, email: record.key },
        'batch'
      )
    );
    return created.isOk() ? created.value.id : undefined;
  }
  return {
    async readTable(signal) {
      const table = await throwOnErr(() =>
        storage.getCrmPipelineTable(pipeline.id)
      );
      const rows = [];
      let after: string | undefined;
      do {
        signal.throwIfAborted();
        const page = await throwOnErr(() =>
          storage.queryCrmPipelineRows(pipeline.id, {
            after,
            query: { filter: null },
          })
        );
        rows.push(
          ...page.rows.map((row) => ({
            cells: Object.fromEntries(
              table.columns.map((column) => [
                column.column.id,
                pipelineCell(row.cells[column.column.id], column),
              ])
            ),
          }))
        );
        after = page.next ?? undefined;
      } while (after);
      return {
        columns: table.columns.map((column) =>
          pipelineViewColumn(column, pipeline)
        ),
        rows,
      };
    },
    async describeRecords(ids, signal) {
      const records = new Map<string, PipelineCsvRecord>();
      if (pipeline.recordType === 'company') {
        for (const company of await companies(signal))
          records.set(company.id, {
            name: company.name,
            key: company.domains[0]?.domain ?? '',
          });
      }
      const missing = ids.filter((id) => !records.has(id));
      await runConcurrently(missing, CONCURRENCY, async (id) => {
        signal.throwIfAborted();
        if (pipeline.recordType === 'company') {
          const company = await storage.getCompany({
            companyId: id,
            includeContacts: false,
          });
          if (company.isOk())
            records.set(id, {
              name: company.value.name ?? '',
              key: company.value.domains[0]?.domain ?? '',
            });
          return;
        }
        const contact = await storage.getContact({ contactId: id });
        if (contact.isOk())
          records.set(id, {
            name: contact.value.name ?? '',
            key: contact.value.email ?? '',
          });
      });
      return records;
    },
    async resolveRecords(records, signal, progress) {
      const domains = new Map<string, Promise<string | undefined>>();
      for (const company of await companies(signal))
        for (const { domain } of company.domains)
          domains.set(domain.toLowerCase(), Promise.resolve(company.id));
      const ids = new Map<string, string>();
      // A record named on several rows takes its first row's name.
      const seen = new Set<string>();
      const unique = records.filter(
        (record) => !seen.has(record.key) && seen.add(record.key)
      );
      await runConcurrently(unique, CONCURRENCY, async (record) => {
        signal.throwIfAborted();
        const id =
          pipeline.recordType === 'company'
            ? await companyId(domains, record, record.key)
            : await contactId(domains, record);
        if (id) ids.set(record.key, id);
        progress(ids.size);
      });
      return ids;
    },
    async insertRows(rows, columns, onRejected) {
      const entries = rows.map((cells) => ({ id: uuidv7(), cells }));
      const labels = new Map(
        columns.map((column) => [
          column.id,
          column.options.map((option) => option.label),
        ])
      );
      async function write(
        batch: typeof entries,
        start: number
      ): Promise<void> {
        const insert: DatabaseOp = {
          kind: 'rows',
          table: pipeline.tableId,
          change: { kind: 'insert', rows: batch.map(({ cells }) => cells) },
        };
        const additions = missingOptionLabels(
          insert,
          (id) => labels.get(id) ?? []
        );
        const optionGroups = additions.map(({ column, labels: added }) => ({
          columnId: column,
          options: added.map((label) => ({ id: uuidv7(), label })),
        }));
        try {
          await insertGraphqlCrmPipelineRows({
            pipelineId: pipeline.id,
            tableId: pipeline.tableId,
            optionGroups,
            rows: batch.map(({ id, cells }) => ({
              id,
              cells: cells.map(({ column, value }) => ({
                columnId: column,
                value: importCellValue(value),
              })),
            })),
          });
        } catch (error) {
          if (!(error instanceof ThrownResultError)) throw error;
          const refusal = error.errors.find(
            ({ code }) => code === 'INVALID_OP'
          );
          if (!refusal) throw error;
          if (!onRejected) throw new PipelineImportRefusal(refusal.message);
          // A refusal rolls back the entire batch, including new options. Split
          // only refused batches so valid rows still commit with their options.
          if (batch.length === 1) {
            onRejected(start, refusal.message);
            return;
          }
          const middle = Math.floor(batch.length / 2);
          await write(batch.slice(0, middle), start);
          await write(batch.slice(middle), start + middle);
          return;
        }
        for (const { column, labels: added } of additions)
          labels.set(column, [...(labels.get(column) ?? []), ...added]);
      }
      for (let start = 0; start < entries.length; start += INSERT_BATCH)
        await write(entries.slice(start, start + INSERT_BATCH), start);
    },
    async refresh() {
      await Promise.all([
        deps.client.invalidateQueries({ queryKey: soupKeys._def }),
        refreshCrmCreateLists(deps.hasLiveCache()),
        deps.client.invalidateQueries({
          queryKey: crmKeys.pipelineTable(pipeline.id).queryKey,
        }),
        deps.client.invalidateQueries({
          queryKey: ['crm', 'pipeline', pipeline.id],
        }),
      ]);
    },
  };
}
