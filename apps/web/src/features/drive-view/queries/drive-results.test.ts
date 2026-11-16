import type { DocumentEntity, EntityData } from '@entity';
import { describe, expect, it } from 'vitest';
import type { DriveSelection } from '../context/drive-source';
import { orderDriveEntities } from './drive-results';

const selection: DriveSelection = {
  location: { kind: 'tab', tab: 'owned' },
  scope: 'default',
  sort: 'name',
  search: '',
  facets: {},
};

function file(id: string, name: string, updatedAt: string): EntityData {
  return {
    type: 'document',
    id,
    name,
    ownerId: 'me',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt,
    fileType: 'md',
  } as DocumentEntity;
}

describe('orderDriveEntities with the name sort', () => {
  it('reads A to Z regardless of case, with newest first inside a tie', () => {
    const entities = [
      file('zeta', 'zeta notes', '2026-03-01T00:00:00Z'),
      file('alpha', 'Alpha notes', '2026-03-02T00:00:00Z'),
      file('older-tie', 'Beta notes', '2026-02-01T00:00:00Z'),
      file('newer-tie', 'beta notes', '2026-04-01T00:00:00Z'),
    ];

    expect(
      orderDriveEntities(entities, selection, []).map((entity) => entity.id)
    ).toEqual(['alpha', 'newer-tie', 'older-tie', 'zeta']);
  });

  it('breaks a name and update tie by descending ID', () => {
    const entities = [
      file('a', 'Notes', '2026-03-01T00:00:00Z'),
      file('c', 'notes', '2026-03-01T00:00:00Z'),
      file('b', 'Notes', '2026-03-01T00:00:00Z'),
    ];

    expect(
      orderDriveEntities(entities, selection, []).map((entity) => entity.id)
    ).toEqual(['c', 'b', 'a']);
  });

  it('puts an empty name first, as the server does', () => {
    const entities = [
      file('named', 'Alpha', '2026-03-01T00:00:00Z'),
      file('empty', '', '2026-03-01T00:00:00Z'),
    ];

    expect(
      orderDriveEntities(entities, selection, []).map((entity) => entity.id)
    ).toEqual(['empty', 'named']);
  });

  it('keeps the local-search featured prefix ahead of the alphabet', () => {
    const entities = [
      file('alpha', 'Alpha notes', '2026-03-01T00:00:00Z'),
      file('zeta', 'zeta notes', '2026-03-02T00:00:00Z'),
    ];

    expect(
      orderDriveEntities(entities, selection, ['zeta']).map(
        (entity) => entity.id
      )
    ).toEqual(['zeta', 'alpha']);
  });

  it('leaves recency sorts on their timestamps', () => {
    const entities = [
      file('alpha', 'Alpha notes', '2026-03-01T00:00:00Z'),
      file('zeta', 'zeta notes', '2026-03-02T00:00:00Z'),
    ];

    expect(
      orderDriveEntities(
        entities,
        { ...selection, sort: 'updated_at' },
        []
      ).map((entity) => entity.id)
    ).toEqual(['zeta', 'alpha']);
  });
});
