import { throwOnErr } from '@core/util/result';
import { databasesClient } from '@service-storage/databases';
import { readMarketingTable } from '@service-storage/email-marketing';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import type { MarketingRepository } from '../context/contracts';
import {
  type Campaign,
  campaignSchema,
  type Enrollment,
  enrollmentSchema,
  type MarketingSnapshot,
} from '../core/model';

const DATABASE_NAME = 'Email Marketing';
const CAMPAIGNS = 'Email campaigns';
const ENROLLMENTS = 'Sequence enrollments';
const HEADERS = [
  'Record ID',
  'Name',
  'Status',
  'Contact email',
  'Sequence data',
];

export function createDatabaseMarketingRepository(): MarketingRepository {
  let databaseId: string | undefined;
  let writable = true;
  let tables: TableDetail[] = [];
  let rowIds = new Map<string, string>();
  let creating: Promise<void> | undefined;

  function column(table: TableDetail, name: string) {
    const result = table.columns.find(
      (item) =>
        (item.column.display_name ??
          item.definition.definition.display_name) === name
    );
    if (!result)
      throw new Error(
        `The ${name} column is missing. Open the backing database to restore it.`
      );
    return result;
  }

  async function load(): Promise<MarketingSnapshot> {
    const listed = await throwOnErr(() => databasesClient.list());
    const matches = listed.filter(
      (item) =>
        !item.database.trashed_at &&
        item.database.name === DATABASE_NAME &&
        item.tables.some((table) => table.name === CAMPAIGNS)
    );
    if (matches.length > 1)
      throw new Error(
        'Multiple Email Marketing databases were found. Rename the extra database to choose the workspace.'
      );
    databaseId = matches[0]?.database.id;
    if (!databaseId) {
      tables = [];
      rowIds = new Map();
      return { campaigns: [], enrollments: [], writable: true };
    }
    const detail = await throwOnErr(() =>
      databasesClient.get({ id: databaseId! })
    );
    writable = detail.grant === 'owner' || detail.grant === 'edit';
    const found = [CAMPAIGNS, ENROLLMENTS].map((name) => {
      const table = detail.tables.find((table) => table.table.name === name);
      if (!table)
        throw new Error(
          `The ${name} table is missing from the Email Marketing database.`
        );
      return table;
    });
    const [campaignRows, enrollmentRows] = await Promise.all(
      found.map((table) =>
        readMarketingTable(
          table.table.id,
          column(table, 'Sequence data').column.property_definition_id
        )
      )
    );
    // Publish version and row handles only after both reads succeed.
    tables = found;
    rowIds = new Map();
    const campaigns = campaignRows.map((row) => {
      const value = campaignSchema.parse(row.payload);
      rowIds.set(value.id, row.rowId);
      return value;
    });
    const enrollments = enrollmentRows.map((row) => {
      const value = enrollmentSchema.parse(row.payload);
      rowIds.set(value.id, row.rowId);
      return value;
    });
    return { campaigns, enrollments, databaseId, writable };
  }

  async function initialize() {
    await load();
    if (databaseId) return;
    const database = await throwOnErr(() =>
      databasesClient.create({ name: DATABASE_NAME })
    );
    databaseId = database.id;
    // Import keys stay stable through retries within this initialization.
    for (const name of [CAMPAIGNS, ENROLLMENTS])
      await throwOnErr(() =>
        databasesClient.importTable({
          id: database.id,
          request: {
            name,
            columns: HEADERS,
            rows: [],
            requestId: crypto.randomUUID(),
          },
        })
      );
    await load();
  }

  async function save(value: Campaign | Enrollment, tableName: string) {
    if (!databaseId) {
      creating ??= initialize().finally(() => {
        creating = undefined;
      });
      await creating;
    }
    if (!writable)
      throw new Error('You need edit access to this Email Marketing database.');
    const table = tables.find((table) => table.table.name === tableName);
    if (!table || !databaseId)
      throw new Error('Email Marketing storage could not be initialized.');
    const row = rowIds.get(value.id);
    const values = [
      value.id,
      'name' in value ? value.name : value.campaignName,
      value.status,
      'contact' in value ? value.contact.email : '',
      JSON.stringify(value),
    ];
    const cells = HEADERS.map((name, index) => ({
      column: column(table, name).column.id,
      value: { type: 'text' as const, value: values[index] },
    }));
    const result = await throwOnErr(async () =>
      databasesClient.applyOps({
        id: databaseId!,
        request: {
          baseVersions: Object.fromEntries(
            tables.map((entry) => [entry.table.id, entry.table.version])
          ),
          ops: [
            {
              kind: 'rows',
              table: table.table.id,
              change: row
                ? {
                    kind: 'update',
                    changes: { kind: 'uniform', rows: [row], cells },
                  }
                : { kind: 'insert', rows: [cells] },
            },
          ],
        },
      })
    );
    for (const change of result.changes)
      if (change.table === table.table.id) table.table.version = change.version;
    const inserted = result.results.find(
      (result) => result.kind === 'rows' && result.change.kind === 'inserted'
    );
    if (inserted?.kind === 'rows' && inserted.change.kind === 'inserted')
      rowIds.set(value.id, inserted.change.rows[0]);
  }
  return {
    load,
    saveCampaign: (value) => save(campaignSchema.parse(value), CAMPAIGNS),
    saveEnrollment: (value) => save(enrollmentSchema.parse(value), ENROLLMENTS),
  };
}
