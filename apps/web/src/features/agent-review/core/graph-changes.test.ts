import { expect, it } from 'vitest';
import { graphChanges } from './graph-changes';

it('counts captured changes once per component, including its anchor and excluding missing files', () => {
  const changes = graphChanges(
    {
      title: 'Data flow',
      nodes: [
        {
          id: 'data',
          title: 'Data',
          location: { path: 'data.ts', side: 'new', line: 1 },
          files: ['store.ts', 'store.ts', 'missing.ts'],
        },
        {
          id: 'ui',
          title: 'UI',
          location: { path: 'ui.ts', side: 'new', line: 1 },
        },
      ],
      edges: [],
    },
    [
      { path: 'data.ts', status: 'modified', added: 8, removed: 4 },
      { path: 'store.ts', status: 'added', added: 3, removed: 1 },
      { path: 'ui.ts', status: 'modified', added: 12, removed: 0 },
    ]
  );
  expect(changes.get('data')).toMatchObject({ added: 11, removed: 5 });
  expect(changes.get('data')!.files.map((file) => file.path)).toEqual([
    'data.ts',
    'store.ts',
  ]);
  expect(changes.get('ui')).toMatchObject({ added: 12, removed: 0 });
  expect(changes.get('ui')!.files).toHaveLength(1);
});

it('opens bundled files on the correct side and preserves authored component and descendant anchors', () => {
  const changes = graphChanges(
    {
      title: 'Components',
      nodes: [
        {
          id: 'parent',
          title: 'Parent',
          files: ['old.ts', 'child.ts', 'binary.png'],
          location: { path: 'shared.ts', side: 'new', line: 14 },
        },
        {
          id: 'child',
          parent: 'parent',
          title: 'Child',
          location: { path: 'child.ts', side: 'new', line: 28 },
        },
        {
          id: 'shared',
          parent: 'parent',
          title: 'Shared',
          location: { path: 'shared.ts', side: 'new', line: 99 },
        },
      ],
      edges: [],
    },
    ['shared.ts', 'old.ts', 'child.ts', 'binary.png'].map((path) => ({
      path,
      status: path === 'old.ts' ? 'deleted' : 'modified',
      added: 0,
      removed: 0,
    }))
  );
  expect(changes.get('parent')!.files.map((file) => file.location)).toEqual([
    { path: 'shared.ts', side: 'new', line: 14 },
    { path: 'binary.png', side: 'new', line: 1 },
    { path: 'child.ts', side: 'new', line: 28 },
    { path: 'old.ts', side: 'old', line: 1 },
  ]);
  expect(changes.get('shared')!.files[0].location.line).toBe(99);
});
