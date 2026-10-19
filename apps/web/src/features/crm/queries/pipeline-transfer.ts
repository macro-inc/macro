import type { DatabaseOp } from '@core/database-sql/generated/types';
import { ThrownResultError, throwOnErr } from '@core/util/result';
import { soupKeys } from '@queries/soup/keys';
import { v7 as uuidv7 } from 'uuid';
import { missingOptionLabels } from '../../database/core/cell-ops';
import { toViewColumn } from '../../database/queries/column-detail';
import type { PipelineTransfer } from '../context/pipelines';
import { importedDomain } from '../core/import-companies';
import type { Pipeline } from '../core/pipeline';
import type { PipelineCsvRecord } from '../core/pipeline-csv';
import { runConcurrently } from '../core/run-concurrently';
import type { CrmRecordDependencies } from './dependencies';
import { fetchCrmExportCompanies } from './export';
import { crmKeys } from './keys';
import { pipelineCell } from './pipeline-data';

const CONCURRENCY = 4;
/** Rows per write; the service accepts up to 10,000. */
const INSERT_BATCH = 500;

/** Bulk reads and writes of one pipeline, over its own routes. */
export function createPipelineTransfer(
  deps: CrmRecordDependencies,
  pipeline: Pipeline
): PipelineTransfer {
  const { storage } = deps;
  const companies = (signal: AbortSignal) =>
    fetchCrmExportCompanies(storage, signal, () => {});
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
      const company = await storage.createCompany({
        name: record.name,
        domain,
      });
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
    const created = await storage.createContact({
      companyId: company,
      name: record.name,
      email: record.key,
    });
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
      return { columns: table.columns.map(toViewColumn), rows };
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
          const company = await storage.getCompany({ companyId: id });
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
            key: contact.value.email,
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
    async insertRows(rows, columns) {
      const labels = new Map(
        columns.map((column) => [
          column.id,
          column.options.map((option) => option.label),
        ])
      );
      for (let start = 0; start < rows.length; start += INSERT_BATCH) {
        const insert: DatabaseOp = {
          kind: 'rows',
          table: pipeline.tableId,
          change: {
            kind: 'insert',
            rows: rows.slice(start, start + INSERT_BATCH),
          },
        };
        const options: DatabaseOp[] = missingOptionLabels(
          insert,
          (id) => labels.get(id) ?? []
        ).map(({ column, labels: added }) => {
          labels.set(column, [...(labels.get(column) ?? []), ...added]);
          return {
            kind: 'column',
            table: pipeline.tableId,
            column,
            change: {
              kind: 'add_options',
              options: added.map((label) => ({ id: uuidv7(), label })),
            },
          };
        });
        const applied = await storage.applyCrmPipelineOps(pipeline.id, {
          ops: [...options, insert],
        });
        if (applied.isErr()) throw new ThrownResultError(applied.error);
      }
    },
    async refresh() {
      await Promise.all([
        deps.client.invalidateQueries({ queryKey: soupKeys._def }),
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
