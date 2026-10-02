import { DatabaseQueryNode } from '@macro-inc/lexical-core/nodes/DatabaseQueryNode';
import { describe, expect, it } from 'vitest';
import { availableActions } from './available-actions';
import type { Action } from './types';

const icon = () => null;
const run = () => {};

const actions: Action[] = [
  {
    id: 'database-query',
    name: 'Database',
    keywords: ['database'],
    category: 'Media',
    icon,
    dependencies: [DatabaseQueryNode],
    action: run,
  },
  {
    id: 'paragraph',
    name: 'Normal Text',
    keywords: ['paragraph'],
    category: 'Elements',
    icon,
    action: run,
  },
];

describe('slash menu actions', () => {
  it('offers the database answer while databases are on', () => {
    expect(
      availableActions(actions, {
        databasesEnabled: true,
        hasNodes: () => true,
      }).map((action) => action.id)
    ).toEqual(['database-query', 'paragraph']);
  });

  it('leaves the database answer out while databases are off', () => {
    expect(
      availableActions(actions, {
        databasesEnabled: false,
        hasNodes: () => true,
      }).map((action) => action.id)
    ).toEqual(['paragraph']);
  });

  it('leaves out ignored actions and actions whose nodes the editor lacks', () => {
    expect(
      availableActions(actions, {
        databasesEnabled: true,
        hasNodes: () => false,
      }).map((action) => action.id)
    ).toEqual(['paragraph']);
    expect(
      availableActions(actions, {
        databasesEnabled: true,
        ignoreActionIds: ['paragraph'],
        hasNodes: () => true,
      }).map((action) => action.id)
    ).toEqual(['database-query']);
  });
});
