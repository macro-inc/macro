import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import { describe, expect, it } from 'vitest';
import { databaseSqlSchema } from './catalog';
import { readCatalogFixture } from './tests/catalog-fixture';

const id = (tail: string) =>
  `01990000-0000-7000-8000-${tail.padStart(12, '0')}`;
const CRM = id('cdb01');
const OTHER = id('cdb02');
const DEALS = id('c7a01');
const CONTACTS = id('c7a02');
const OTHER_CONTACTS = id('c7a03');
const OTHER_LEADS = id('c7a04');
const NAME_COLUMN = id('c0c001');
const STAGE_COLUMN = id('c0c002');
const TIER_COLUMN = id('c0c003');
const CONTACT_COLUMN = id('c0c004');
const EMAIL_COLUMN = id('c0c005');
const OWNER_COLUMN = id('c0c006');
const NAME = id('de0001');
const STAGE = id('de0002');
const TIER = id('de0003');
const CONTACT = id('de0004');
const EMAIL = id('de0005');
const OWNER = id('de0006');
const WON = id('0e0001');
const LEAD = id('0e0002');
const TWO = id('0e0003');
const HALF = id('0e0004');

const definition = (
  id: string,
  display_name: string,
  data_type: DatabaseDetail['tables'][number]['columns'][number]['definition']['definition']['data_type'],
  is_multi_select = false
) => ({
  id,
  owner: { scope: 'database' as const, database_id: CRM },
  display_name,
  data_type,
  is_multi_select,
  specific_entity_type: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  is_system: false,
  is_metadata: false,
});

const option = (
  id: string,
  display_order: number,
  value: { type: 'string'; value: string } | { type: 'number'; value: number }
) => ({
  id,
  property_definition_id: STAGE,
  display_order,
  value,
  color: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const crm: DatabaseDetail = {
  database: {
    id: CRM,
    name: 'CRM',
    owner_id: 'macro|owner@databases.test',
    created_at: '2026-01-01T00:00:00Z',
    trashed_at: null,
  },
  grant: 'edit',
  tables: [
    {
      views: [],
      table: {
        id: DEALS,
        database_id: CRM,
        name: 'Deals',
        position: 'a',
        version: 3,
      },
      sql_name: '"Deals"',
      columns: [
        {
          shared_outside_database: false,
          column: {
            id: NAME_COLUMN,
            table_id: DEALS,
            property_definition_id: NAME,
            position: 'a',
            config: null,
            display_name: 'Deal name',
            infer_type: false,
          },
          sql_name: '"Deal name"',
          definition: {
            definition: definition(NAME, 'Name', 'STRING'),
            property_options: [],
          },
          writable: true,
        },
        {
          shared_outside_database: false,
          column: {
            id: STAGE_COLUMN,
            table_id: DEALS,
            property_definition_id: STAGE,
            position: 'b',
            config: null,
            display_name: null,
            infer_type: false,
          },
          sql_name: '"Stage"',
          definition: {
            definition: definition(STAGE, 'Stage', 'SELECT_STRING'),
            property_options: [
              option(WON, 1, { type: 'string', value: 'Won' }),
              option(LEAD, 0, { type: 'string', value: 'Lead' }),
            ],
          },
          writable: true,
        },
        {
          shared_outside_database: false,
          column: {
            id: TIER_COLUMN,
            table_id: DEALS,
            property_definition_id: TIER,
            position: 'c',
            config: null,
            display_name: null,
            infer_type: false,
          },
          sql_name: '"Tier"',
          definition: {
            definition: definition(TIER, 'Tier', 'SELECT_NUMBER', true),
            property_options: [
              option(TWO, 0, { type: 'number', value: 2 }),
              option(HALF, 1, { type: 'number', value: 2.5 }),
            ],
          },
          writable: true,
        },
        {
          shared_outside_database: false,
          column: {
            id: CONTACT_COLUMN,
            table_id: DEALS,
            property_definition_id: CONTACT,
            position: 'd',
            config: {
              kind: 'link',
              database_id: CRM,
              table_id: CONTACTS,
            },
            display_name: null,
            infer_type: false,
          },
          sql_name: '"Contact"',
          definition: {
            definition: definition(CONTACT, 'Contact', 'ENTITY'),
            property_options: [],
          },
          writable: true,
        },
      ],
    },
    {
      views: [],
      table: {
        id: CONTACTS,
        database_id: CRM,
        name: 'Contacts',
        position: 'b',
        version: 1,
      },
      sql_name: '"Contacts"',
      columns: [
        {
          shared_outside_database: false,
          column: {
            id: EMAIL_COLUMN,
            table_id: CONTACTS,
            property_definition_id: EMAIL,
            position: 'a',
            config: null,
            display_name: null,
            infer_type: false,
          },
          sql_name: '"Email"',
          definition: {
            definition: definition(EMAIL, 'Email', 'LINK'),
            property_options: [],
          },
          writable: true,
        },
        {
          shared_outside_database: false,
          column: {
            id: OWNER_COLUMN,
            table_id: CONTACTS,
            property_definition_id: OWNER,
            position: 'b',
            config: null,
            display_name: null,
            infer_type: false,
          },
          sql_name: '"Owner"',
          definition: {
            definition: definition(OWNER, 'Owner', 'ENTITY', false),
            property_options: [],
          },
          writable: true,
        },
      ],
    },
  ],
};

describe('databaseSqlSchema', () => {
  it('offers the platform people table with no databases at all', () => {
    expect(databaseSqlSchema([])).toEqual({
      databases: [],
      platform: ['people'],
    });
  });

  it('describes a database detail as the schema the engine builds its catalog from', () => {
    expect(databaseSqlSchema([crm])).toEqual({
      ...readCatalogFixture('crm').schema,
      platform: ['people'],
    });
  });

  it('describes every database a scoped statement can name', () => {
    const other: DatabaseDetail = {
      ...crm,
      database: { ...crm.database, id: OTHER, name: 'crm' },
      tables: [
        {
          ...crm.tables[1],
          table: {
            ...crm.tables[1].table,
            id: OTHER_CONTACTS,
            database_id: OTHER,
            name: 'contacts',
          },
        },
        {
          ...crm.tables[1],
          table: {
            ...crm.tables[1].table,
            id: OTHER_LEADS,
            database_id: OTHER,
            name: 'Leads',
          },
        },
      ],
    };

    const fixture = readCatalogFixture('scoped');
    expect(databaseSqlSchema([crm, other])).toEqual({
      ...fixture.schema,
      platform: ['people'],
    });
    expect(fixture.scope).toBe(CRM);
  });
});
