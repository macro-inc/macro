import type { ListedDatabase } from '@service-storage/generated/schemas/listedDatabase';
import { describe, expect, it } from 'vitest';
import type { DriveSelection } from '../context/drive-source';
import { availableDriveState } from '../primitives/drive-state';
import {
  selectDriveDatabases,
  selectSidebarDatabases,
} from './drive-databases';
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
      project_id: null,
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
      project_id: null,
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
      project_id: null,
    },
    grant: 'owner',
    tables: [],
  },
];

const none: ReadonlySet<string> = new Set();

describe('Drive database listing', () => {
  it('separates owned and shared databases and excludes trash', () => {
    expect(
      selectDriveDatabases(listed, selection, 'me', none).map(
        (entity) => entity.id
      )
    ).toEqual(['mine']);
    expect(
      selectDriveDatabases(
        listed,
        { ...selection, location: { kind: 'tab', tab: 'shared' } },
        'me',
        none
      ).map((entity) => entity.id)
    ).toEqual(['shared']);
    expect(
      selectDriveDatabases(
        listed,
        { ...selection, scope: 'all' },
        'me',
        none
      ).map((entity) => entity.id)
    ).toEqual(['mine', 'shared']);
  });
  it('leaves out the databases made for forms kept out of Drive', () => {
    expect(
      selectDriveDatabases(
        listed,
        { ...selection, scope: 'all' },
        'me',
        new Set(['shared'])
      ).map((entity) => entity.id)
    ).toEqual(['mine']);
  });
  it('searches names without depending on the document search service', () => {
    expect(
      selectDriveDatabases(
        listed,
        { ...selection, search: ' PRODUCT ' },
        'me',
        none
      ).map((entity) => entity.id)
    ).toEqual(['mine']);
    expect(
      selectDriveDatabases(
        listed,
        { ...selection, search: 'customer' },
        'me',
        none
      )
    ).toEqual([]);
  });
  it("lists a folder's databases, owned or shared, inside that folder only", () => {
    const filed: ListedDatabase[] = [
      ...listed,
      {
        database: {
          id: 'filed-mine',
          name: 'Client intake',
          owner_id: 'me',
          created_at: '2026-09-05T00:00:00Z',
          trashed_at: null,
          project_id: 'clients',
        },
        grant: 'owner',
        tables: [],
      },
      {
        database: {
          id: 'filed-shared',
          name: 'Client contacts',
          owner_id: 'other',
          created_at: '2026-09-06T00:00:00Z',
          trashed_at: null,
          project_id: 'clients',
        },
        grant: 'edit',
        tables: [],
      },
    ];
    const folder = {
      ...selection,
      location: { kind: 'folder', id: 'clients' },
    } satisfies DriveSelection;
    const inFolder = selectDriveDatabases(filed, folder, 'me', none);
    expect(inFolder.map((entity) => entity.id)).toEqual([
      'filed-mine',
      'filed-shared',
    ]);
    expect(inFolder[0]?.projectId).toBe('clients');
    expect(
      inFolder.every((entity) =>
        driveEntityMatchesLocation(entity, folder, 'me')
      )
    ).toBe(true);
    expect(
      selectDriveDatabases(
        filed,
        { ...folder, location: { kind: 'folder', id: 'other-folder' } },
        'me',
        none
      )
    ).toEqual([]);
    expect(
      selectDriveDatabases(
        filed,
        { ...folder, search: 'contacts' },
        'me',
        none
      ).map((entity) => entity.id)
    ).toEqual(['filed-shared']);
    // Tabs stay flat: a filed database is still among the owner's databases.
    expect(
      selectDriveDatabases(filed, selection, 'me', none).map(
        (entity) => entity.id
      )
    ).toEqual(['mine', 'filed-mine']);
  });
  it('does not claim attachment status or view history', () => {
    for (const selected of [
      {
        ...selection,
        location: { kind: 'folder', id: null },
      } satisfies DriveSelection,
      {
        ...selection,
        location: { kind: 'tab', tab: 'recent' },
      } satisfies DriveSelection,
      { ...selection, scope: 'attachments' } satisfies DriveSelection,
    ]) {
      expect(selectDriveDatabases(listed, selected, 'me', none)).toEqual([]);
    }
    expect(selectDriveDatabases(listed, selection, undefined, none)).toEqual(
      []
    );
  });
  it('preserves scope through the normalized list filter and sorts the available timestamp', () => {
    const selected = { ...selection, scope: 'all' } satisfies DriveSelection;
    const entities = selectDriveDatabases(listed, selected, 'me', none);
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

describe('disabled database filters', () => {
  it('masks a persisted Database choice while keeping other types and route intent', () => {
    const state = {
      ...selection,
      facets: { type: ['database', 'doc-markdown'], tags: ['urgent'] },
      expandedFolderIds: [],
      favoritesOpen: false,
      databasesOpen: true,
      rootOpen: true,
    };
    expect(availableDriveState(state, false, true).facets).toEqual({
      type: ['doc-markdown'],
      tags: ['urgent'],
    });
    expect(availableDriveState(state, true, true)).toBe(state);
    expect(
      availableDriveState(
        { ...state, facets: { type: ['form', 'doc-markdown'], tags: [] } },
        true,
        false
      ).facets.type
    ).toEqual(['doc-markdown']);
    expect(state.facets.type).toEqual(['database', 'doc-markdown']);
  });
});

describe('Drive sidebar databases', () => {
  it('lists owned and shared live databases by name, without hidden ones', () => {
    const another: ListedDatabase = {
      database: {
        id: 'another',
        name: 'Hiring pipeline',
        owner_id: 'me',
        created_at: '2026-09-05T00:00:00Z',
        trashed_at: null,
        project_id: null,
      },
      grant: 'owner',
      tables: [],
    };
    const poll: ListedDatabase = {
      ...another,
      database: { ...another.database, id: 'poll', name: 'Lunch poll' },
    };
    expect(
      selectSidebarDatabases([...listed, another, poll], new Set(['poll'])).map(
        (entity) => entity.id
      )
    ).toEqual(['shared', 'another', 'mine']);
  });
});
