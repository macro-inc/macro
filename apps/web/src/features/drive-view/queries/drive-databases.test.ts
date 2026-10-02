import type { ListedDatabase } from '@service-storage/generated/schemas/listedDatabase';
import { describe, expect, it } from 'vitest';
import type { DriveSelection } from '../context/drive-source';
import { selectDriveDatabases } from './drive-databases';
import {
  driveEntityMatchesLocation,
  orderDriveEntities,
} from './drive-results';

const selection: DriveSelection = {
  location: { kind: 'tab', tab: 'owned' },
  scope: 'default',
  sort: 'updated_at',
  search: '',
  facets: {},
};
const listed: ListedDatabase[] = [
  {
    database: {
      id: 'mine',
      name: 'Product roadmap',
      owner_id: 'me',
      created_at: '2026-09-01T00:00:00Z',
      trashed_at: null,
    },
    grant: 'owner',
    tables: [],
  },
  {
    database: {
      id: 'shared',
      name: 'Customer roadmap',
      owner_id: 'other',
      created_at: '2026-09-02T00:00:00Z',
      trashed_at: null,
    },
    grant: 'view',
    tables: [],
  },
  {
    database: {
      id: 'trash',
      name: 'Archived',
      owner_id: 'me',
      created_at: '2026-09-03T00:00:00Z',
      trashed_at: '2026-09-04T00:00:00Z',
    },
    grant: 'owner',
    tables: [],
  },
];

describe('Drive database listing', () => {
  it('separates owned and shared databases and excludes trash', () => {
    expect(
      selectDriveDatabases(listed, selection, 'me').map((entity) => entity.id)
    ).toEqual(['mine']);
    expect(
      selectDriveDatabases(
        listed,
        { ...selection, location: { kind: 'tab', tab: 'shared' } },
        'me'
      ).map((entity) => entity.id)
    ).toEqual(['shared']);
    expect(
      selectDriveDatabases(listed, { ...selection, scope: 'all' }, 'me').map(
        (entity) => entity.id
      )
    ).toEqual(['mine', 'shared']);
  });
  it('searches names without depending on the document search service', () => {
    expect(
      selectDriveDatabases(
        listed,
        { ...selection, search: ' PRODUCT ' },
        'me'
      ).map((entity) => entity.id)
    ).toEqual(['mine']);
    expect(
      selectDriveDatabases(listed, { ...selection, search: 'customer' }, 'me')
    ).toEqual([]);
  });
  it('does not claim folder membership, attachment status or view history', () => {
    for (const selected of [
      {
        ...selection,
        location: { kind: 'folder', id: 'folder' },
      } satisfies DriveSelection,
      {
        ...selection,
        location: { kind: 'tab', tab: 'recent' },
      } satisfies DriveSelection,
      { ...selection, scope: 'attachments' } satisfies DriveSelection,
    ]) {
      expect(selectDriveDatabases(listed, selected, 'me')).toEqual([]);
    }
    expect(selectDriveDatabases(listed, selection, undefined)).toEqual([]);
  });
  it('preserves scope through the normalized list filter and sorts the available timestamp', () => {
    const selected = { ...selection, scope: 'all' } satisfies DriveSelection;
    const entities = selectDriveDatabases(listed, selected, 'me');
    expect(
      entities.every((entity) =>
        driveEntityMatchesLocation(entity, selected, 'me')
      )
    ).toBe(true);
    expect(
      orderDriveEntities(entities, selected, []).map((entity) => entity.id)
    ).toEqual(['shared', 'mine']);
  });
});
