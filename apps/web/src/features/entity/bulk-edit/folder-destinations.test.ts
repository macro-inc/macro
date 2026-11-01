import type { FolderRow } from '@queries/storage/folder-list';
import { describe, expect, it } from 'vitest';
import type { EntityData } from '../types/entity';
import {
  entitiesToMove,
  folderDestinations,
  folderPickerItems,
  indexFolders,
} from './folder-destinations';

const folder = (
  id: string,
  name: string,
  options: { parentId?: string; userId?: string; createdAt?: string } = {}
): FolderRow => ({
  id,
  name,
  parentId: options.parentId,
  userId: options.userId ?? 'macro|me',
  createdAt: options.createdAt,
});

const doc = (id: string, projectId?: string): EntityData => ({
  id,
  type: 'document',
  name: id,
  ownerId: 'macro|me',
  projectId,
});

const folderRow = (id: string, projectId?: string): EntityData => ({
  id,
  type: 'project',
  name: id,
  ownerId: 'macro|me',
  projectId,
});

describe('entitiesToMove', () => {
  const folders = indexFolders([
    folder('work', 'Work'),
    folder('q4', 'Q4', { parentId: 'work' }),
    folder('notes', 'Notes', { parentId: 'q4' }),
  ]);

  it('skips what the folder already holds', () => {
    const inside = doc('inside', 'q4');
    const outside = doc('outside', 'work');

    expect(entitiesToMove([inside, outside], 'q4', folders)).toEqual([outside]);
    expect(entitiesToMove([inside], 'q4', folders)).toEqual([]);
  });

  it('refuses to put a folder inside itself or anything under it', () => {
    const work = folderRow('work');

    expect(entitiesToMove([work], 'work', folders)).toEqual([]);
    expect(entitiesToMove([work], 'notes', folders)).toEqual([]);
    expect(entitiesToMove([doc('a'), work], 'notes', folders)).toEqual([]);
  });

  it('lets a folder move into an unrelated one', () => {
    const notes = folderRow('notes', 'q4');

    expect(entitiesToMove([notes], 'work', folders)).toEqual([notes]);
  });

  it('survives a parent loop in the folder data', () => {
    const looped = indexFolders([
      folder('a', 'A', { parentId: 'b' }),
      folder('b', 'B', { parentId: 'a' }),
    ]);

    expect(entitiesToMove([doc('item')], 'a', looped)).toHaveLength(1);
  });
});

describe('folderDestinations', () => {
  const names = (options: Parameters<typeof folderDestinations>[0]) =>
    folderDestinations(options).map((destination) => [
      destination.group,
      destination.name,
    ]);

  it('lists open folders first, then created, then shared, newest first', () => {
    expect(
      names({
        folders: [
          folder('old-shared', 'Old shared', {
            userId: 'macro|teammate',
            createdAt: '2026-01-01T00:00:00Z',
          }),
          folder('old-mine', 'Old mine', { createdAt: '2026-02-01T00:00:00Z' }),
          folder('open-b', 'Open B', { userId: 'macro|teammate' }),
          folder('new-mine', 'New mine', { createdAt: '2026-03-01T00:00:00Z' }),
          folder('new-shared', 'New shared', {
            userId: 'macro|teammate',
            createdAt: '2026-04-01T00:00:00Z',
          }),
          folder('open-a', 'Open A'),
        ],
        openFolderIds: ['open-a', 'open-b'],
        userId: 'macro|me',
        entities: [doc('item')],
      })
    ).toEqual([
      ['open', 'Open A'],
      ['open', 'Open B'],
      ['created', 'New mine'],
      ['created', 'Old mine'],
      ['shared', 'New shared'],
      ['shared', 'Old shared'],
    ]);
  });

  it('shows nested folders with their parents as the path', () => {
    const [nested] = folderDestinations({
      folders: [
        folder('notes', 'Notes', { parentId: 'q4' }),
        folder('q4', 'Q4', { parentId: 'work' }),
        folder('work', 'Work'),
      ],
      openFolderIds: ['notes'],
      userId: 'macro|me',
      entities: [doc('item')],
    });

    expect(nested).toMatchObject({ name: 'Notes', path: 'Work / Q4' });
  });

  it('leaves out the open folder the items already live in', () => {
    expect(
      names({
        folders: [folder('here', 'Here'), folder('there', 'There')],
        openFolderIds: ['here', 'there'],
        userId: 'macro|me',
        entities: [doc('a', 'here'), doc('b', 'here')],
      })
    ).toEqual([['open', 'There']]);
  });

  it('keeps a folder that holds only some of the items', () => {
    expect(
      names({
        folders: [folder('here', 'Here')],
        openFolderIds: [],
        userId: 'macro|me',
        entities: [doc('a', 'here'), doc('b')],
      })
    ).toEqual([['created', 'Here']]);
  });

  it('leaves out a moved folder and everything under it', () => {
    expect(
      names({
        folders: [
          folder('work', 'Work'),
          folder('q4', 'Q4', { parentId: 'work' }),
          folder('other', 'Other'),
        ],
        openFolderIds: ['q4'],
        userId: 'macro|me',
        entities: [folderRow('work')],
      })
    ).toEqual([['created', 'Other']]);
  });
});

describe('folderPickerItems', () => {
  const destinations = folderDestinations({
    folders: [
      folder('roadmap', 'Roadmap'),
      folder('road', 'Road', { userId: 'macro|teammate' }),
      folder('broad', 'Broad strokes'),
      folder('unrelated', 'Invoices'),
    ],
    openFolderIds: ['broad'],
    userId: 'macro|me',
    entities: [doc('item')],
  });
  const rows = (query: string) =>
    folderPickerItems(destinations, query).map((item) =>
      item.kind === 'folder' ? item.name : `create:${item.name}`
    );

  it('keeps the priority order until something is typed', () => {
    expect(rows('  ')).toEqual([
      'Broad strokes',
      'Roadmap',
      'Invoices',
      'Road',
    ]);
  });

  it('puts better name matches ahead of an open folder', () => {
    expect(rows('road').slice(0, 3)).toEqual([
      'Road',
      'Roadmap',
      'Broad strokes',
    ]);
  });

  it('offers to create a folder unless the name is taken', () => {
    expect(rows('road')).not.toContain('create:road');
    expect(rows('Inv')).toEqual(['Invoices', 'create:Inv']);
    expect(rows('  Plans ')).toEqual(['create:Plans']);
  });
});
