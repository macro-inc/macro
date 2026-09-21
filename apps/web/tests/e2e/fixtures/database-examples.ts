import type { Page } from '@playwright/test';
import type {
  DatabaseDetail,
  ExecOutcome,
} from '../../../src/lib/service-clients/service-storage/databases';

type ExampleColumn = {
  name: string;
  type: 'STRING' | 'NUMBER' | 'DATE' | 'SELECT_STRING' | 'ENTITY';
  options?: string[];
  relationTo?: string;
};
type ExampleTable = {
  name: string;
  columns: ExampleColumn[];
  rows: (string | number | null)[][];
};

/** Fixed, synthetic data with known answers for real model and browser checks. */
export const databaseExamples: { name: string; tables: ExampleTable[] }[] = [
  {
    name: 'Example · Support desk',
    tables: [
      {
        name: 'Tickets',
        columns: [
          { name: 'Name', type: 'STRING' },
          { name: 'Customer', type: 'ENTITY', relationTo: 'Customers' },
          {
            name: 'Status',
            type: 'SELECT_STRING',
            options: ['Open', 'In progress', 'Waiting', 'Done'],
          },
          {
            name: 'Priority',
            type: 'SELECT_STRING',
            options: ['Urgent', 'High', 'Medium', 'Low'],
          },
          { name: 'Estimate', type: 'NUMBER' },
          { name: 'Created', type: 'DATE' },
        ],
        rows: [
          ['Cannot invite teammate', 'Acme', 'Open', 'High', 2, '2026-09-01'],
          ['Export omits a column', 'Orbit', 'Open', 'Medium', 3, '2026-09-02'],
          [
            'Search misses archived docs',
            'Acme',
            'In progress',
            'High',
            8,
            '2026-09-03',
          ],
          [
            'Calendar sync delayed',
            'Northstar',
            'Waiting',
            'Medium',
            5,
            '2026-09-04',
          ],
          ['Update billing address', 'Orbit', 'Done', 'Low', 1, '2026-09-05'],
          [
            'Mobile sign-in fails',
            'Northstar',
            'In progress',
            'Urgent',
            13,
            '2026-09-06',
          ],
          ['Rename workspace', 'Acme', 'Done', 'Low', 2, '2026-09-07'],
          ['Import date format', 'Orbit', 'Open', 'Medium', 3, '2026-09-08'],
          [
            'Restore deleted project',
            'Northstar',
            'Waiting',
            'High',
            8,
            '2026-09-09',
          ],
          [
            'Notification preferences',
            'Acme',
            'In progress',
            'Medium',
            5,
            '2026-09-10',
          ],
          ['Share link permission', 'Orbit', 'Open', 'High', 2, '2026-09-11'],
          ['Change profile photo', 'Northstar', 'Done', 'Low', 1, '2026-09-12'],
        ],
      },
      {
        name: 'Customers',
        columns: [
          { name: 'Name', type: 'STRING' },
          {
            name: 'Plan',
            type: 'SELECT_STRING',
            options: ['Team', 'Enterprise'],
          },
          { name: 'Seats', type: 'NUMBER' },
        ],
        rows: [
          ['Acme', 'Enterprise', 80],
          ['Orbit', 'Team', 12],
          ['Northstar', 'Enterprise', 45],
        ],
      },
    ],
  },
  {
    name: 'Example · Sales pipeline',
    tables: [
      {
        name: 'Deals',
        columns: [
          { name: 'Name', type: 'STRING' },
          { name: 'Company', type: 'STRING' },
          {
            name: 'Stage',
            type: 'SELECT_STRING',
            options: ['Lead', 'Qualified', 'Proposal', 'Won', 'Lost'],
          },
          { name: 'Amount', type: 'NUMBER' },
          { name: 'Close date', type: 'DATE' },
          { name: 'Owner', type: 'STRING' },
        ],
        rows: [
          ['Acme rollout', 'Acme', 'Won', 18000, '2026-07-15', 'Avery'],
          ['Orbit renewal', 'Orbit', 'Won', 6000, '2026-07-22', 'Sam'],
          [
            'Northstar expansion',
            'Northstar',
            'Won',
            24000,
            '2026-08-10',
            'Avery',
          ],
          ['Cedar pilot', 'Cedar', 'Lost', 5000, '2026-08-20', 'Sam'],
          ['Atlas annual plan', 'Atlas', 'Won', 36000, '2026-09-12', 'Sam'],
          [
            'Willow team plan',
            'Willow',
            'Proposal',
            9000,
            '2026-09-25',
            'Avery',
          ],
          ['Harbor launch', 'Harbor', 'Qualified', 15000, '2026-10-10', 'Sam'],
          ['Summit discovery', 'Summit', 'Lead', 12000, '2026-10-25', 'Avery'],
        ],
      },
    ],
  },
];

/** Add missing examples through the app API; never replace existing user edits. */
export async function seedDatabaseExamples(page: Page, backendOrigin: string) {
  const hostname = new URL(backendOrigin).hostname;
  if (
    !['localhost', '127.0.0.1'].includes(hostname) &&
    !hostname.endsWith('.localhost')
  )
    throw new Error('Database examples must be seeded on a local backend.');
  // Reuse the browser's authenticated API context so HMR/navigation cannot
  // interrupt an accepted fixture mutation. Cookies are never exported.
  const api = page.context().request;
  async function request<T>(
    path: string,
    body?: unknown,
    method?: string
  ): Promise<T> {
    const response = await api.fetch(`${backendOrigin}/dss${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      maxRedirects: 0,
      timeout: 180_000,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { data: body }),
    });
    if (!response.ok())
      throw new Error(`${path}: ${response.status()} ${await response.text()}`);
    return response.json();
  }
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const literal = (value: string | number | null) =>
    value === null
      ? 'NULL'
      : typeof value === 'number'
        ? String(value)
        : `'${value.replaceAll("'", "''")}'`;
  const existing =
    await request<{ database: { id: string; name: string } }[]>('/databases');
  const seeded: DatabaseDetail[] = [];
  for (const example of databaseExamples) {
    const matches = existing.filter(
      (item) => item.database.name === example.name
    );
    if (matches.length > 1)
      throw new Error(
        `Multiple databases named ${example.name}; choose the intended example before seeding.`
      );
    const database =
      existing.find((item) => item.database.name === example.name)?.database ??
      (await request<{ id: string; name: string }>('/databases', {
        name: example.name,
      }));
    let detail = await request<DatabaseDetail>(`/databases/${database.id}`);
    // New databases already have a starter table. Reuse it so an example
    // opens directly onto its data instead of an unrelated empty tab.
    if (
      !matches.length &&
      detail.tables.length === 1 &&
      detail.tables[0].columns.length === 0
    ) {
      const starter = detail.tables[0].table;
      await request(
        `/databases/${database.id}/tables/${starter.id}`,
        {
          name: example.tables[0].name,
          previousName: starter.name,
        },
        'PATCH'
      );
      detail = await request<DatabaseDetail>(`/databases/${database.id}`);
    }
    // Create every table before its columns so relationships can reference a
    // later tab without depending on the order of the example's UI.
    for (const table of example.tables) {
      if (!detail.tables.some((item) => item.table.name === table.name)) {
        await request(`/databases/${database.id}/tables`, {
          name: table.name,
        });
      }
    }
    detail = await request<DatabaseDetail>(`/databases/${database.id}`);
    for (const table of example.tables) {
      const target = detail.tables.find(
        (item) => item.table.name === table.name
      )!.table;
      for (const column of table.columns) {
        const relationTarget = column.relationTo
          ? detail.tables.find((item) => item.table.name === column.relationTo)
          : undefined;
        if (column.relationTo && !relationTarget)
          throw new Error(`Missing relationship target ${column.relationTo}.`);
        const renamed = detail.tables
          .find((item) => item.table.id === target.id)
          ?.columns.some(
            (item) =>
              item.definition.definition.display_name === column.name &&
              item.column.display_name != null &&
              item.column.display_name !== column.name
          );
        if (renamed)
          throw new Error(
            `Example column ${table.name}.${column.name} has been renamed; keeping it.`
          );
        const current = detail.tables
          .find((item) => item.table.id === target.id)
          ?.columns.find(
            (item) =>
              (item.column.display_name ??
                item.definition.definition.display_name) === column.name
          );
        if (current) {
          const config = current.column.config;
          const matches = relationTarget
            ? config?.kind === 'link' &&
              config.database_id === database.id &&
              config.table_id === relationTarget.table.id
            : !config &&
              current.definition.definition.data_type === column.type;
          if (!matches)
            throw new Error(
              `Example column ${table.name}.${column.name} has been changed; keeping it.`
            );
          continue;
        }
        await request(`/databases/${database.id}/tables/${target.id}/columns`, {
          binding: {
            kind: 'new',
            name: column.name,
            data_type: column.type,
            is_multi_select: !!relationTarget,
            options: column.options,
          },
          ...(relationTarget
            ? {
                linkToTableId: relationTarget.table.id,
                linkToDatabaseId: database.id,
              }
            : {}),
        });
      }
    }
    detail = await request<DatabaseDetail>(`/databases/${database.id}`);
    const pending = [...example.tables];
    const ready = new Set<string>();
    while (pending.length) {
      const index = pending.findIndex((table) =>
        table.columns.every(
          (column) => !column.relationTo || ready.has(column.relationTo)
        )
      );
      if (index < 0) throw new Error('Example relationships contain a cycle.');
      const table = pending.splice(index, 1)[0];
      const schema = detail.tables.find(
        (item) => item.table.name === table.name
      )!;
      const columns = table.columns.map(
        (column) =>
          schema.columns.find(
            (item) =>
              (item.column.display_name ??
                item.definition.definition.display_name) === column.name
          )!
      );
      const scalarIndexes = table.columns.flatMap((column, index) =>
        column.relationTo ? [] : [index]
      );
      for (const [index, column] of table.columns.entries()) {
        if (!column.relationTo) continue;
        const target = detail.tables.find(
          (item) => item.table.name === column.relationTo
        )!;
        const nameColumn = target.columns.find(
          (item) =>
            (item.column.display_name ??
              item.definition.definition.display_name) === 'Name'
        )!;
        const names = [...new Set(table.rows.map((row) => row[index]))].filter(
          (value) => value !== null
        );
        if (!names.length) continue;
        const matches = await request<ExecOutcome>('/databases/query', {
          sql: `SELECT ${quote(nameColumn.sql_name)}, COUNT(*) FROM ${quote(target.read_sql_name ?? target.sql_name)} WHERE ${quote(nameColumn.sql_name)} IN (${names.map(literal).join(', ')}) GROUP BY ${quote(nameColumn.sql_name)}`,
        });
        if (
          names.some(
            (name) =>
              !matches.results[0]?.rows.some(
                (row) => row[0] === name && row[1] === 1
              )
          )
        )
          throw new Error(
            `Example ${column.relationTo} names have changed or are ambiguous; keeping existing records.`
          );
      }
      const statements = table.rows.flatMap((row) => {
        const insert = `INSERT INTO ${quote(schema.sql_name)} (${scalarIndexes.map((index) => quote(columns[index].sql_name)).join(', ')}) SELECT ${scalarIndexes.map((index) => literal(row[index])).join(', ')} WHERE NOT EXISTS (SELECT 1 FROM ${quote(schema.sql_name)} WHERE ${quote(columns[0].sql_name)} = ${literal(row[0])})`;
        const links = table.columns.flatMap((column, index) => {
          if (!column.relationTo || row[index] === null) return [];
          const target = detail.tables.find(
            (item) => item.table.name === column.relationTo
          )!;
          const targetName = target.columns.find(
            (column) =>
              (column.column.display_name ??
                column.definition.definition.display_name) === 'Name'
          )!;
          const junction = columns[index].junction_sql_name;
          if (!junction)
            throw new Error(
              `Missing relationship SQL metadata for ${table.name}.${column.name}.`
            );
          // Only link rows inserted by this exec. Existing edits, including an
          // intentionally cleared relationship, survive subsequent seeding.
          return [
            `INSERT INTO ${quote(junction)} (row_id, linked_id) SELECT t.row_id, c.row_id FROM ${quote(schema.sql_name)} t JOIN ${quote(target.sql_name)} c ON c.${quote(targetName.sql_name)} = ${literal(row[index])} WHERE t.${quote(columns[0].sql_name)} = ${literal(row[0])} AND t.row_id LIKE 'new:%'`,
          ];
        });
        return [insert, ...links];
      });
      await request<ExecOutcome>('/databases/exec', {
        sql: statements.join(';\n'),
      });
      ready.add(table.name);
    }
    seeded.push(await request<DatabaseDetail>(`/databases/${database.id}`));
  }
  return seeded;
}
