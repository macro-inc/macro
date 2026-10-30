import type { DatabaseOp } from '@core/database-sql/generated/types';
import { throwOnErr } from '@core/util/result';
import { databasesClient } from '@service-storage/databases';
import { readMarketingTable } from '@service-storage/email-marketing';
import type { ListedDatabase } from '@service-storage/generated/schemas/listedDatabase';
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
const TABLE_NAMES = [CAMPAIGNS, ENROLLMENTS] as const;
/** The table the server adds to every new database. */
const STARTER_TABLE = 'Table 1';
const HEADERS = [
  'Record ID',
  'Name',
  'Status',
  'Contact email',
  'Sequence data',
];
/** Row writes share a 2 MiB request limit; keep a margin for headers and ops. */
const MAX_WRITE_BYTES = 1_500_000;

/**
 * Pick this user's own Email Marketing database. Shared databases are never
 * adopted: delivery acts on the signed-in user's inbox, so a teammate's records
 * must not drive it. A database holding only the server's starter table is a
 * bootstrap that stopped before its tables were imported.
 */
function chooseDatabase(listed: ListedDatabase[]) {
  const candidates = listed.filter(
    (item) =>
      item.grant === 'owner' &&
      !item.database.trashed_at &&
      item.database.name === DATABASE_NAME &&
      (item.tables.some((table) =>
        TABLE_NAMES.some((name) => name === table.name)
      ) ||
        (item.tables.length === 1 && item.tables[0].name === STARTER_TABLE))
  );
  const hasCampaigns = (item: ListedDatabase) =>
    item.tables.some((table) => table.name === CAMPAIGNS);
  // Oldest first, preferring databases that already hold campaigns, so two
  // racing first writes settle on the same database.
  return candidates.sort(
    (a, b) =>
      Number(hasCampaigns(b)) - Number(hasCampaigns(a)) ||
      a.database.created_at.localeCompare(b.database.created_at) ||
      a.database.id.localeCompare(b.database.id)
  )[0];
}

export function createDatabaseMarketingRepository(): MarketingRepository {
  let databaseId: string | undefined;
  let writable = true;
  let tables: TableDetail[] = [];
  let missingTables: string[] = [...TABLE_NAMES];
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
    databaseId = chooseDatabase(listed)?.database.id;
    if (!databaseId) {
      tables = [];
      missingTables = [...TABLE_NAMES];
      rowIds = new Map();
      return { campaigns: [], enrollments: [], writable: true };
    }
    const detail = await throwOnErr(() =>
      databasesClient.get({ id: databaseId! })
    );
    writable = detail.grant === 'owner' || detail.grant === 'edit';
    const found = TABLE_NAMES.map((name) =>
      detail.tables.find((table) => table.table.name === name)
    );
    // A missing table reads as empty; the next write imports it.
    const [campaignRows, enrollmentRows] = await Promise.all(
      found.map((table) =>
        table
          ? readMarketingTable(
              table.table.id,
              column(table, 'Sequence data').column.property_definition_id
            )
          : []
      )
    );
    // Publish version and row handles only after both reads succeed.
    tables = found.filter((table) => table !== undefined);
    missingTables = TABLE_NAMES.filter((_, index) => !found[index]);
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

  /** Create the database or finish an interrupted setup, then reload. */
  async function initialize() {
    await load();
    if (databaseId && !missingTables.length) return;
    if (databaseId && !writable)
      throw new Error('You need edit access to this Email Marketing database.');
    if (!databaseId) {
      const database = await throwOnErr(() =>
        databasesClient.create({ name: DATABASE_NAME })
      );
      databaseId = database.id;
    }
    const id = databaseId;
    // Import keys stay stable through retries within this initialization.
    for (const name of missingTables)
      await throwOnErr(() =>
        databasesClient.importTable({
          id,
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
    if (!databaseId || missingTables.length) {
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
    const request: { ops: DatabaseOp[]; baseVersions: Record<string, number> } =
      {
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
      };
    if (
      new TextEncoder().encode(JSON.stringify(request)).length > MAX_WRITE_BYTES
    )
      throw new Error(
        'This sequence is too large to save. Shorten its emails and try again.'
      );
    const id = databaseId;
    const result = await throwOnErr(async () =>
      databasesClient.applyOps({ id, request })
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
