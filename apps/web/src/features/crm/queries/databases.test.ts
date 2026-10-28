import type { ListedDatabase } from '@service-storage/generated/schemas/listedDatabase';
import { describe, expect, it } from 'vitest';
import { crmDatabasesInput, selectCrmDatabases } from './databases';

const listed: ListedDatabase[] = [
  {
    database: {
      id: 'database-1',
      name: 'Account tracker',
      owner_id: 'owner',
      created_at: '2026-01-01T00:00:00Z',
      trashed_at: null,
    },
    grant: 'view',
    tables: [],
  },
  {
    database: {
      id: 'database-2',
      name: 'Unrelated tracker',
      owner_id: 'owner',
      created_at: '2026-01-01T00:00:00Z',
      trashed_at: null,
    },
    grant: 'owner',
    tables: [],
  },
  {
    database: {
      id: 'trashed',
      name: 'Old tracker',
      owner_id: 'owner',
      created_at: '2026-01-01T00:00:00Z',
      trashed_at: '2026-02-01T00:00:00Z',
    },
    grant: 'owner',
    tables: [],
  },
];

describe('CRM database discovery', () => {
  it('deduplicates matching databases and excludes missing, trashed, and unrelated databases', () => {
    const result = selectCrmDatabases(
      [
        { databaseId: 'missing' },
        { databaseId: 'database-1' },
        { databaseId: 'database-1' },
        { databaseId: 'trashed' },
      ],
      listed
    );
    expect(result.map((database) => database.id)).toEqual(['database-1']);
    expect(result[0].grant).toBe('view');
    expect(selectCrmDatabases([], listed)).toEqual([]);
  });

  it('uses the complete authorized activity scope without enumerating CRM records or tables', () => {
    const filters = crmDatabasesInput()?.filters;
    expect(filters?.crmAssociation).toEqual({ activity: true });
    expect(filters?.databaseRowFilter).toEqual({ literal: { include: true } });
    expect(filters?.documentFilter).toEqual({
      literal: { id: '00000000-0000-0000-0000-000000000000' },
    });
  });

  it('keeps company and contact scopes separate', () => {
    expect(
      crmDatabasesInput({
        type: 'company',
        id: 'company-1',
        domains: ['example.com'],
      })?.filters?.crmAssociation
    ).toEqual({ company: 'company-1' });
    expect(
      crmDatabasesInput({
        type: 'contact',
        id: 'contact-1',
        email: 'person@example.com',
        companyId: 'company-1',
      })?.filters?.crmAssociation
    ).toEqual({ contact: 'contact-1' });
  });
});
