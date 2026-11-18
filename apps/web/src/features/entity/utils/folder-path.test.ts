import { describe, expect, it } from 'vitest';
import { type KnownFolder, knownFolderPath } from './folder-path';

const folders = (list: KnownFolder[]) =>
  new Map(list.map((folder) => [folder.id, folder]));

describe('knownFolderPath', () => {
  it('names every folder from the root down to the folder', () => {
    const known = folders([
      { id: 'root', name: 'Clients', parentId: null, ownerId: 'owner' },
      { id: 'mid', name: 'Archive 01', parentId: 'root', ownerId: 'owner' },
      { id: 'leaf', name: 'Q2', parentId: 'mid', ownerId: 'owner' },
    ]);

    expect(knownFolderPath(known, 'leaf')).toEqual({
      id: 'leaf',
      name: 'Q2',
      ownerId: 'owner',
      path: ['Clients', 'Archive 01', 'Q2'],
    });
  });

  it('gives no path when an ancestor is missing, so the server answers', () => {
    const known = folders([
      { id: 'leaf', name: 'Q2', parentId: 'not-loaded', ownerId: 'owner' },
    ]);

    expect(knownFolderPath(known, 'leaf')).toBeUndefined();
  });

  it('gives no path for a folder it does not hold', () => {
    expect(knownFolderPath(folders([]), 'leaf')).toBeUndefined();
  });

  it('gives no path for a parent cycle', () => {
    const known = folders([
      { id: 'a', name: 'A', parentId: 'b', ownerId: 'owner' },
      { id: 'b', name: 'B', parentId: 'a', ownerId: 'owner' },
    ]);

    expect(knownFolderPath(known, 'a')).toBeUndefined();
  });
});
