import { DatabaseQueryNode } from '@macro-inc/lexical-core/nodes/DatabaseQueryNode';
import { DocumentCardNode } from '@macro-inc/lexical-core/nodes/DocumentCardNode';
import { describe, expect, it } from 'vitest';
import { availableActions, mergeActions } from './available-actions';
import type { Action } from './types';

const icon = () => null;
const run = () => {};

const actions: Action[] = [
  {
    id: 'database-query',
    name: 'Query',
    keywords: ['query'],
    category: 'Media',
    icon,
    dependencies: [DatabaseQueryNode],
    action: run,
  },
  {
    id: 'database',
    name: 'Database',
    keywords: ['database'],
    category: 'Media',
    icon,
    dependencies: [DocumentCardNode],
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
    ).toEqual(['database-query', 'database', 'paragraph']);
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
    ).toEqual(['database-query', 'database']);
  });
});

it('additional actions replace an ID in source order without mutating either catalog', () => {
  const override: Action = { ...actions[2], name: 'Replacement' };
  const extra: Action = { ...actions[2], id: 'extra' };
  const merged = mergeActions(actions, [override, extra]);
  expect(merged.map((action) => action.id)).toEqual([
    'database-query',
    'database',
    'paragraph',
    'extra',
  ]);
  expect(merged[2]).toBe(override);
  expect(actions[2].name).toBe('Normal Text');
});
