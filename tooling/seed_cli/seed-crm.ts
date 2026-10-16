import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { parseArgs } from 'node:util';
import type {
  CellWrite,
  DatabaseOp,
} from '../../apps/web/src/lib/core/database-sql/generated/types';
import { buildGraphqlEntitySoupInput } from '../../apps/web/src/lib/queries/soup/graphql/entity-input';
import type { TeamWithMembers } from '../../apps/web/src/lib/service-clients/service-auth/generated/schemas/teamWithMembers';
import type { AccessiblePipeline } from '../../apps/web/src/lib/service-clients/service-storage/generated/schemas/accessiblePipeline';
import type { CrmCompanyResponse } from '../../apps/web/src/lib/service-clients/service-storage/generated/schemas/crmCompanyResponse';
import type { CrmContactResponse } from '../../apps/web/src/lib/service-clients/service-storage/generated/schemas/crmContactResponse';
import type { PropertyDefinitionWithOptions } from '../../apps/web/src/lib/service-clients/service-storage/generated/schemas/propertyDefinitionWithOptions';
import type { StorageRows } from '../../apps/web/src/lib/service-clients/service-storage/generated/schemas/storageRows';
import type { TableDetail } from '../../apps/web/src/lib/service-clients/service-storage/generated/schemas/tableDetail';
import type {
  GraphqlEntityFilterAst,
  SoupInput,
} from '../../apps/web/src/lib/service-clients/service-storage/graphql/generated/graphql';
import fixture from './seed/crm.json';

// Only local passwordless auth returns a code. Never point this seed at hosted data.
const { values } = parseArgs({
  options: {
    origin: { type: 'string' },
    email: { type: 'string' },
    help: { type: 'boolean' },
  },
});
if (values.help || !values.origin || !values.email) {
  console.log(
    'Usage: bun tooling/seed_cli/seed-crm.ts --origin https://localhost:<proxy-port> --email <local-account-email>'
  );
  process.exit(values.help ? 0 : 1);
}
const origin = new URL(values.origin);
if (
  !['localhost', '127.0.0.1', '[::1]', hostname()].includes(origin.hostname)
) {
  throw new Error('CRM seeding requires a local stack hostname.');
}
const email = values.email.toLowerCase();
let accessToken: string | undefined;
const created = { companies: 0, contacts: 0, pipelines: 0, rows: 0 };

async function send<T>(
  method: string,
  path: string,
  data?: unknown
): Promise<T> {
  const response = await fetch(new URL(path, origin), {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    tls: { rejectUnauthorized: false },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok)
    throw new Error(`${method} ${path}: HTTP ${response.status}`);
  const body = await response.text();
  return JSON.parse(body || 'null');
}

// Use the app's exclusion filters so reads cannot accidentally mix other entities in.
const base = buildGraphqlEntitySoupInput(
  'DATABASE_ROW',
  '00000000-0000-0000-0000-000000000000'
)?.initial?.filters;
async function readSoup<T>(
  filters: GraphqlEntityFilterAst,
  selection: string
): Promise<T[]> {
  const items: T[] = [];
  let input: SoupInput = {
    initial: {
      filters: { ...base, ...filters },
      limit: 500,
      sortMethod: 'CREATED_AT',
    },
  };
  const seen = new Set<string>();
  for (;;) {
    type SoupResult = {
      data?: { user: { soup: { items: T[]; nextCursor?: string | null } } };
      errors?: { message: string }[];
    };
    const result: SoupResult = await send<SoupResult>(
      'POST',
      '/dss/items/soup/graphql',
      {
        query: `query SeedCrm($input: SoupInput!) { user { soup(input: $input) { items { ${selection} } nextCursor } } }`,
        variables: { input },
      }
    );
    if (result.errors?.length || !result.data)
      throw new Error(`CRM seed read failed: ${JSON.stringify(result.errors)}`);
    items.push(...result.data.user.soup.items);
    const cursor: string | null | undefined = result.data.user.soup.nextCursor;
    if (!cursor) return items;
    if (seen.has(cursor))
      throw new Error('CRM seed pagination did not advance.');
    seen.add(cursor);
    input = { continuation: { cursor } };
  }
}

type Company = { id: string; domains: string[] };
type SeedRecord = {
  id: string;
  key: string;
  stage: string;
  revenue: number;
  notes: string;
  unassigned?: boolean;
};
async function applyOps(pipelineId: string, ops: DatabaseOp[]) {
  if (ops.length)
    await send('POST', `/dss/crm/pipelines/${pipelineId}/ops`, { ops });
}

try {
  const login = await send<{ code?: string }>(
    'POST',
    '/auth/login/passwordless',
    { email, redirect_uri: `${origin.origin}/app/companies` }
  );
  if (!login.code)
    throw new Error(
      'Expected local passwordless auth. No seed data was written.'
    );
  const tokens = await send<{ access_token: string }>(
    'GET',
    `/auth/oauth/passwordless/${encodeURIComponent(login.code)}?email=${encodeURIComponent(email)}&disable_redirect=true`
  );
  accessToken = tokens.access_token;
  const team = await send<TeamWithMembers>('GET', '/auth/team');
  if (!team?.team?.crm_enabled)
    throw new Error(
      'Enable CRM for this local account’s team in Settings → CRM, then rerun.'
    );
  const owner = `macro|${email}`;
  const companies = await readSoup<Company>(
    { crmCompanyFilter: { literal: { hidden: false } } },
    '... on GraphqlSoupCrmCompany { id domains }'
  );
  const definitions = await send<PropertyDefinitionWithOptions[]>(
    'GET',
    '/dss/properties/definitions?scope=team&include_options=true'
  );
  const customStages = definitions.find(
    (entry) =>
      entry.definition.display_name === 'Deal Stage' &&
      entry.definition.data_type === 'SELECT_STRING'
  );
  const stageDefinition = customStages?.property_options.length
    ? customStages
    : (
        await send<PropertyDefinitionWithOptions[]>(
          'GET',
          '/dss/properties/definitions?scope=all&include_options=true'
        )
      ).find(
        (entry) =>
          entry.definition.id === '00000001-0000-0000-0000-000000000010'
      );
  if (!stageDefinition)
    throw new Error('CRM Stage property is missing from this local database.');
  const stages = stageDefinition.property_options.map((option) => ({
    id: option.id,
    label: option.value.value,
  }));
  const companyRecords: SeedRecord[] = [];
  const contactRecords: SeedRecord[] = [];

  for (const [index, sample] of fixture.companies.entries()) {
    const domain = `${sample.key}.crm-seed.example.com`;
    let company = companies.find((item) => item.domains.includes(domain));
    const stage =
      stages.find((item) => item.label === sample.stage) ??
      stages[index % stages.length];
    if (!stage || typeof stage.label !== 'string')
      throw new Error('This team needs at least one text stage.');
    const record = {
      key: sample.key,
      stage: stage.label,
      revenue: sample.revenue,
      notes: sample.notes,
      unassigned: sample.unassigned,
    };
    if (!company) {
      const added = await send<CrmCompanyResponse>(
        'POST',
        '/dss/crm/companies',
        { name: sample.name, domain }
      );
      company = { id: added.id, domains: [domain] };
      created.companies++;
      companies.push(company);
      // Initialize legacy CRM fields only on new sample companies; reruns preserve edits.
      const propertyPath = `/dss/properties/entities/COMPANY/${company.id}`;
      await send('PUT', `${propertyPath}/${stageDefinition.definition.id}`, {
        value: { type: 'select_option', option_id: stage.id },
      });
      await send(
        'PUT',
        `${propertyPath}/00000001-0000-0000-0000-000000000012`,
        { value: { type: 'number', value: sample.revenue } }
      );
      if (!sample.unassigned)
        await send(
          'PUT',
          `${propertyPath}/00000001-0000-0000-0000-000000000011`,
          {
            value: {
              type: 'entity_reference',
              reference: { entity_type: 'USER', entity_id: owner },
            },
          }
        );
    }
    companyRecords.push({ ...record, id: company.id });
    const contacts = await send<CrmContactResponse[]>(
      'GET',
      `/dss/crm/companies/${company.id}/contacts`
    );
    for (const name of sample.contacts) {
      const contactEmail = `${name.toLowerCase().replaceAll(' ', '.')}@${domain}`;
      let contact = contacts.find((item) => item.email === contactEmail);
      if (!contact) {
        contact = await send<CrmContactResponse>(
          'POST',
          `/dss/crm/companies/${company.id}/contacts`,
          { name, email: contactEmail }
        );
        created.contacts++;
      }
      contactRecords.push({ ...record, id: contact.id });
    }
  }

  const pipelines = await send<AccessiblePipeline[]>(
    'GET',
    '/dss/crm/pipelines'
  );
  for (const sample of fixture.pipelines) {
    let pipeline = pipelines.find(
      (item) =>
        item.name === sample.name && item.recordType === sample.recordType
    );
    if (!pipeline) {
      pipeline = await send<AccessiblePipeline>('POST', '/dss/crm/pipelines', {
        name: sample.name,
        recordType: sample.recordType,
        sharing: sample.sharing,
      });
      created.pipelines++;
      pipelines.push(pipeline);
    }
    const table = await send<TableDetail>(
      'GET',
      `/dss/crm/pipelines/${pipeline.id}/table`
    );
    const column = (name: string) =>
      table.columns.find(
        (item) => item.definition.definition.display_name === name
      )?.column.id;
    const primary = table.columns.find(
      (item) => item.column.id === pipeline.primaryColumnId
    );
    if (!primary) throw new Error(`Missing primary column for ${sample.name}`);
    const existing = new Set<string>();
    let after: string | undefined;
    do {
      const page = await send<StorageRows>(
        'GET',
        `/dss/crm/pipelines/${pipeline.id}/rows${after ? `?after=${after}` : ''}`
      );
      for (const row of page.rows) {
        const value = row.cells[pipeline.primaryColumnId];
        if (value?.type === 'EntityReference')
          for (const ref of value.value) existing.add(ref.entity_id);
      }
      after = page.next ?? undefined;
    } while (after);
    const records = (
      sample.recordType === 'company' ? companyRecords : contactRecords
    ).filter(
      (record) =>
        (!sample.companies || sample.companies.includes(record.key)) &&
        !existing.has(record.id)
    );
    // Preserve all existing pipeline values and custom columns on repeat runs.
    if (!records.length) continue;
    const stageColumn = column('Stage');
    const ownerColumn = column('Owner');
    const revenueColumn = column('Revenue');
    const notesColumn = column('Notes') ?? randomUUID();
    const ops: DatabaseOp[] = column('Notes')
      ? []
      : [
          {
            kind: 'column',
            table: pipeline.tableId,
            column: notesColumn,
            change: {
              kind: 'create',
              definition: {
                source: 'new',
                name: 'Notes',
                type: { type: 'text' },
              },
            },
          },
        ];
    ops.push({
      kind: 'rows',
      table: pipeline.tableId,
      change: {
        kind: 'insert',
        rows: records.map((record): CellWrite[] => [
          {
            column: pipeline.primaryColumnId,
            value: {
              type: 'entities',
              value: [
                {
                  entityType:
                    sample.recordType === 'company' ? 'COMPANY' : 'CONTACT',
                  entityId: record.id,
                },
              ],
            },
          },
          ...(stageColumn
            ? [
                {
                  column: stageColumn,
                  value: {
                    type: 'options' as const,
                    value: [{ label: record.stage }],
                  },
                },
              ]
            : []),
          ...(ownerColumn && !record.unassigned
            ? [
                {
                  column: ownerColumn,
                  value: {
                    type: 'entities' as const,
                    value: [{ entityType: 'USER' as const, entityId: owner }],
                  },
                },
              ]
            : []),
          ...(revenueColumn
            ? [
                {
                  column: revenueColumn,
                  value: { type: 'number' as const, value: record.revenue },
                },
              ]
            : []),
          { column: notesColumn, value: { type: 'text', value: record.notes } },
        ]),
      },
    });
    await applyOps(pipeline.id, ops);
    created.rows += records.length;
  }
  console.log(
    JSON.stringify(
      {
        team: team.team.name,
        created,
        companies: companyRecords.length,
        contacts: contactRecords.length,
        stages: stages.map((stage) => stage.label),
        pipelines: fixture.pipelines.map((pipeline) => pipeline.name),
        url: `${origin.origin}/app/companies`,
      },
      null,
      2
    )
  );
} finally {
  accessToken = undefined;
}
