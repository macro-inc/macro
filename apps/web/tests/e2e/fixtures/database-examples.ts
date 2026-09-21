import type { Page } from '@playwright/test';

type ExampleColumn = {
  name: string;
  type: 'STRING' | 'NUMBER' | 'DATE' | 'SELECT_STRING';
  options?: string[];
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
          { name: 'Customer', type: 'STRING' },
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
  type Detail = {
    database: { id: string; name: string };
    tables: {
      table: { id: string; name: string };
      sql_name: string;
      read_sql_name?: string;
      columns: {
        column: { id: string };
        sql_name: string;
        definition: {
          definition: { display_name: string; data_type: string };
        };
      }[];
    }[];
  };
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
  const seeded: Detail[] = [];
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
    let detail = await request<Detail>(`/databases/${database.id}`);
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
      detail = await request<Detail>(`/databases/${database.id}`);
    }
    for (const table of example.tables) {
      const target =
        detail.tables.find((item) => item.table.name === table.name)?.table ??
        (await request<{ id: string }>(`/databases/${database.id}/tables`, {
          name: table.name,
        }));
      for (const column of table.columns) {
        const current = detail.tables
          .find((item) => item.table.id === target.id)
          ?.columns.find(
            (item) => item.definition.definition.display_name === column.name
          );
        if (current) {
          if (current.definition.definition.data_type !== column.type)
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
            is_multi_select: false,
            options: column.options,
          },
        });
      }
      detail = await request<Detail>(`/databases/${database.id}`);
      const schema = detail.tables.find((item) => item.table.id === target.id)!;
      const columns = table.columns.map(
        (column) =>
          schema.columns.find(
            (item) => item.definition.definition.display_name === column.name
          )!.sql_name
      );
      const statements = table.rows.map(
        (row) =>
          `INSERT INTO ${quote(schema.sql_name)} (${columns.map(quote).join(', ')}) SELECT ${row.map(literal).join(', ')} WHERE NOT EXISTS (SELECT 1 FROM ${quote(schema.sql_name)} WHERE ${quote(columns[0])} = ${literal(row[0])})`
      );
      await request('/databases/exec', { sql: statements.join(';\n') });
    }
    seeded.push(await request<Detail>(`/databases/${database.id}`));
  }
  return seeded;
}
