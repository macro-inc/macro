import type {
  CellValue,
  CellWrite,
  DatabaseOp,
} from '@core/database-sql/generated/types';
import { throwOnErr } from '@core/util/result';
import { databasesClient } from '@service-storage/databases';
import type { ListedDatabase } from '@service-storage/generated/schemas/listedDatabase';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import type { z } from 'zod';
import type { MarketingRepository } from '../context/contracts';
import { MarketingError } from '../core/errors';
import {
  type Campaign,
  campaignSchema,
  type Enrollment,
  enrollmentSchema,
  type MarketingSnapshot,
  normalizeEmail,
  type Unsubscribe,
  unsubscribeSchema,
} from '../core/model';
import { type MarketingRow, readMarketingTable } from './database-rows';

const DATABASE_NAME = 'Email Marketing';
const CAMPAIGNS = 'Email campaigns';
const ENROLLMENTS = 'Sequence enrollments';
const UNSUBSCRIBED = 'Unsubscribed contacts';
const TABLE_NAMES = [CAMPAIGNS, ENROLLMENTS, UNSUBSCRIBED] as const;
type TableName = (typeof TABLE_NAMES)[number];
/** The table the server adds to every new database. */
const STARTER_TABLE = 'Table 1';
/**
 * `Name` labels the row in the database view; the app reads `Sequence data`.
 * A campaign's `Name` edit there renames the campaign.
 */
const NAME = 'Name';
const DATA = 'Sequence data';
const HEADERS = [NAME, DATA];
/** Row writes share a 2 MiB request limit; keep a margin for headers and ops. */
const MAX_WRITE_BYTES = 1_500_000;

/**
 * Pick this user's own Email Marketing database: one named Email Marketing,
 * or, once renamed, one that still holds both its core tables. Shared
 * databases are never adopted: delivery acts on the signed-in user's inbox,
 * so a teammate's records must not drive it. A database named Email
 * Marketing holding only the starter table is a setup that stopped before
 * its tables were imported.
 */
function chooseDatabase(listed: ListedDatabase[]) {
  const has = (item: ListedDatabase, name: string) =>
    item.tables.some((table) => table.name === name);
  const named = (item: ListedDatabase) => item.database.name === DATABASE_NAME;
  const candidates = listed.filter(
    (item) =>
      item.grant === 'owner' &&
      !item.database.trashed_at &&
      ((has(item, CAMPAIGNS) && has(item, ENROLLMENTS)) ||
        (named(item) &&
          (TABLE_NAMES.some((name) => has(item, name)) ||
            (item.tables.length === 1 && has(item, STARTER_TABLE)))))
  );
  // Prefer databases that already hold campaigns, then the oldest, so two
  // racing first writes settle on the same database.
  return candidates.sort(
    (a, b) =>
      Number(has(b, CAMPAIGNS)) - Number(has(a, CAMPAIGNS)) ||
      a.database.created_at.localeCompare(b.database.created_at) ||
      a.database.id.localeCompare(b.database.id)
  )[0];
}

function column(table: TableDetail, name: string) {
  const result = table.columns.find(
    (item) =>
      (item.column.display_name ?? item.definition.definition.display_name) ===
      name
  );
  if (!result) throw new MarketingError('columnMissing', { name });
  return result;
}

/**
 * Parse each row on its own. An empty row (added in the database view) is
 * ignored; a row whose data no longer parses is counted, not dropped silently.
 */
function parseRows<T>(rows: MarketingRow[], schema: z.ZodType<T>) {
  const values: { rowId: string; name?: string; value: T }[] = [];
  let unreadable = 0;
  for (const row of rows) {
    if (!row.data?.trim()) continue;
    let json: unknown;
    try {
      json = JSON.parse(row.data);
    } catch {
      unreadable++;
      continue;
    }
    const parsed = schema.safeParse(json);
    if (parsed.success)
      values.push({ rowId: row.rowId, name: row.name, value: parsed.data });
    else unreadable++;
  }
  return { values, unreadable };
}

/** A version conflict or a table removed under us: reload and try again. */
function writeError(errors: { code: string }[]) {
  return errors.some(
    (error) => error.code === 'CONFLICT' || error.code === 'NOT_FOUND'
  )
    ? new MarketingError('changedElsewhere')
    : undefined;
}

export function createDatabaseMarketingRepository(): MarketingRepository {
  let databaseId: string | undefined;
  let writable = true;
  let tables: TableDetail[] = [];
  let missingTables: TableName[] = [...TABLE_NAMES];
  let rowIds = new Map<string, string>();
  let creating: Promise<void> | undefined;

  const tableNamed = (name: TableName) =>
    tables.find((table) => table.table.name === name);

  async function load(): Promise<MarketingSnapshot> {
    const listed = await throwOnErr(() => databasesClient.list());
    databaseId = chooseDatabase(listed)?.database.id;
    if (!databaseId) {
      writable = true;
      tables = [];
      missingTables = [...TABLE_NAMES];
      rowIds = new Map();
      return {
        campaigns: [],
        enrollments: [],
        unsubscribed: [],
        unreadable: 0,
        writable: true,
      };
    }
    const id = databaseId;
    const detail = await throwOnErr(() => databasesClient.get({ id }));
    const found = TABLE_NAMES.map((name) =>
      detail.tables.find((table) => table.table.name === name)
    );
    // A missing table reads as empty; the next write imports it.
    const rows = await Promise.all(
      found.map((table) =>
        table
          ? readMarketingTable(table.table.id, {
              name: column(table, NAME).column.property_definition_id,
              data: column(table, DATA).column.property_definition_id,
            })
          : []
      )
    );
    const campaigns = parseRows(rows[0], campaignSchema);
    const enrollments = parseRows(rows[1], enrollmentSchema);
    const unsubscribed = parseRows(rows[2], unsubscribeSchema);
    // Publish versions and row handles only after every read succeeds.
    writable = detail.grant === 'owner' || detail.grant === 'edit';
    tables = found.filter((table) => table !== undefined);
    missingTables = TABLE_NAMES.filter((_, index) => !found[index]);
    rowIds = new Map();
    for (const { rowId, value } of [...campaigns.values, ...enrollments.values])
      rowIds.set(value.id, rowId);
    for (const { rowId, value } of unsubscribed.values)
      rowIds.set(unsubscribeKey(value), rowId);
    return {
      campaigns: campaigns.values.map(({ name, value }) => {
        const renamed = name?.trim().slice(0, 120);
        return renamed ? { ...value, name: renamed } : value;
      }),
      enrollments: enrollments.values.map(({ value }) => value),
      unsubscribed: unsubscribed.values.map(({ value }) => value),
      unreadable:
        campaigns.unreadable + enrollments.unreadable + unsubscribed.unreadable,
      databaseId,
      writable,
    };
  }

  /** Create the database or finish an interrupted setup, then reload. */
  async function initialize() {
    await load();
    if (databaseId && !writable) throw new MarketingError('needEditAccess');
    if (databaseId && !missingTables.length) return;
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

  /** One setup at a time, shared by writes that race to start it. */
  async function setUp() {
    try {
      await initialize();
    } finally {
      creating = undefined;
    }
  }

  async function ready() {
    if (databaseId && !writable) throw new MarketingError('needEditAccess');
    if (databaseId && !missingTables.length) return databaseId;
    creating ??= setUp();
    await creating;
    if (!databaseId || missingTables.length)
      throw new MarketingError('storageUnavailable');
    return databaseId;
  }

  async function apply(id: string, ops: DatabaseOp[]) {
    const request = {
      // Every table's version: a write races with any change to the records.
      baseVersions: Object.fromEntries(
        tables.map((entry) => [entry.table.id, entry.table.version])
      ),
      ops,
    };
    if (
      new TextEncoder().encode(JSON.stringify(request)).length > MAX_WRITE_BYTES
    )
      throw new MarketingError('sequenceTooLarge');
    const result = await databasesClient.applyOps({ id, request });
    if (result.isErr()) {
      const conflict = writeError(result.error);
      if (conflict) throw conflict;
      return throwOnErr(async () => result);
    }
    for (const change of result.value.changes) {
      const table = tables.find((entry) => entry.table.id === change.table);
      if (table) table.table.version = change.version;
    }
    return result.value;
  }

  async function save(
    tableName: TableName,
    key: string,
    name: string,
    value: unknown
  ) {
    const id = await ready();
    const table = tableNamed(tableName);
    if (!table) throw new MarketingError('storageUnavailable');
    const row = rowIds.get(key);
    const text = (value: string): CellValue => ({ type: 'text', value });
    const cells: CellWrite[] = [
      { column: column(table, NAME).column.id, value: text(name) },
      {
        column: column(table, DATA).column.id,
        value: text(JSON.stringify(value)),
      },
    ];
    const result = await apply(id, [
      {
        kind: 'rows',
        table: table.table.id,
        change: row
          ? { kind: 'update', changes: { kind: 'uniform', rows: [row], cells } }
          : { kind: 'insert', rows: [cells] },
      },
    ]);
    const inserted = result.results.find(
      (entry) => entry.kind === 'rows' && entry.change.kind === 'inserted'
    );
    if (inserted?.kind === 'rows' && inserted.change.kind === 'inserted')
      rowIds.set(key, inserted.change.rows[0]);
  }

  return {
    load,
    saveCampaign(value: Campaign) {
      const campaign = campaignSchema.parse(value);
      return save(CAMPAIGNS, campaign.id, campaign.name, campaign);
    },
    saveEnrollment(value: Enrollment) {
      const enrollment = enrollmentSchema.parse(value);
      return save(
        ENROLLMENTS,
        enrollment.id,
        enrollment.contact.email,
        enrollment
      );
    },
    saveUnsubscribe(value: Unsubscribe) {
      const entry = unsubscribeSchema.parse(value);
      return save(UNSUBSCRIBED, unsubscribeKey(entry), entry.email, entry);
    },
    async deleteCampaign(campaignId, enrollmentIds) {
      const id = await ready();
      const ops: DatabaseOp[] = [];
      const enrollmentRows = enrollmentIds.flatMap(
        (key) => rowIds.get(key) ?? []
      );
      const enrollmentTable = tableNamed(ENROLLMENTS);
      if (enrollmentRows.length && enrollmentTable)
        ops.push({
          kind: 'rows',
          table: enrollmentTable.table.id,
          change: { kind: 'delete', rows: enrollmentRows },
        });
      const campaignRow = rowIds.get(campaignId);
      const campaignTable = tableNamed(CAMPAIGNS);
      if (campaignRow && campaignTable)
        ops.push({
          kind: 'rows',
          table: campaignTable.table.id,
          change: { kind: 'delete', rows: [campaignRow] },
        });
      if (!ops.length) return;
      await apply(id, ops);
      for (const key of [campaignId, ...enrollmentIds]) rowIds.delete(key);
    },
  };
}

function unsubscribeKey(entry: Unsubscribe) {
  return `unsubscribe:${normalizeEmail(entry.email)}`;
}
