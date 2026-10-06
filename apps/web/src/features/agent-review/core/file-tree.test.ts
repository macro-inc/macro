import { describe, expect, it } from 'vitest';
import {
  fileTree,
  fileTreeRows,
  navigationRows,
  walkthroughTrees,
} from './file-tree';
import type { Chapter } from './model';

const file = (path: string) => ({
  path,
  status: 'modified',
  added: 0,
  removed: 0,
});

const chapter = (paths: string[]): Chapter => ({
  title: 'Reader',
  description: '',
  note: '',
  paths,
  focus: { path: paths[0], side: 'new', line: 1 },
});

describe('walkthrough file navigation', () => {
  it('compacts single-folder chains while keeping sibling folders and files', () => {
    const tree = fileTree(
      ['src/review/core/model.ts', 'src/review/ui.tsx', 'README.md'].map(file)
    );
    expect(tree.map((node) => node.name)).toEqual(['src/review', 'README.md']);
    expect(tree[0]).toMatchObject({
      kind: 'folder',
      path: 'src/review',
      children: [{ name: 'core' }, { name: 'ui.tsx' }],
    });
  });
  it('keeps every file reachable, including files outside the tour and overlapping chapters', () => {
    const groups = walkthroughTrees(
      [chapter(['a.ts', 'missing.ts', 'a.ts']), chapter(['a.ts', 'src/b.ts'])],
      ['a.ts', 'src/b.ts', 'lock.json'].map(file)
    );
    expect(groups.map((group) => [group.title, group.count])).toEqual([
      ['Reader', 1],
      ['Reader', 2],
      ['Other changes', 1],
    ]);
    const rows = navigationRows(groups, new Set());
    const files = rows.flatMap((row) =>
      row.kind === 'file' ? [row.node.path] : []
    );
    expect(files).toEqual(['a.ts', 'src/b.ts', 'a.ts', 'lock.json']);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });
  it('collapses chapters and folders independently without losing their files', () => {
    const groups = walkthroughTrees(
      [chapter(['src/a.ts', 'src/b.ts']), chapter(['src/a.ts'])],
      ['src/a.ts', 'src/b.ts'].map(file)
    );
    const collapsed = navigationRows(
      groups,
      new Set(['chapter:0:src', 'chapter:1'])
    );
    expect(collapsed.map((row) => row.key)).toEqual([
      'chapter:0',
      'chapter:0:src',
      'chapter:1',
    ]);
    expect(
      navigationRows(groups, new Set()).filter((row) => row.kind === 'file')
    ).toHaveLength(3);
  });
  it('supports a large comparison with no walkthrough', () => {
    const files = Array.from({ length: 10000 }, (_, i) =>
      file(`generated/${i}.json`)
    );
    const groups = walkthroughTrees([], files);
    expect(groups[0]).toMatchObject({ title: 'Changes', count: 10000 });
    expect(navigationRows(groups, new Set(['other:generated']))).toHaveLength(
      2
    );
    expect(
      navigationRows(groups, new Set()).filter((row) => row.kind === 'file')
    ).toHaveLength(10000);
  });
  it('shows a full repository tree independently of walkthrough grouping and disclosure', () => {
    const files = [
      'src/b.ts',
      'generated/data.json',
      'src/a.ts',
      'README.md',
    ].map(file);
    const tree = fileTree(files);
    const rows = fileTreeRows(
      tree,
      new Set(['chapter:0:src', 'other:generated'])
    );
    expect(
      rows.filter((row) => row.kind === 'file').map((row) => row.node.path)
    ).toEqual(['generated/data.json', 'src/a.ts', 'src/b.ts', 'README.md']);
    expect(rows.every((row) => row.chapter === undefined)).toBe(true);
    expect(
      fileTreeRows(tree, new Set(['full:src', 'full:generated'])).map(
        (row) => row.key
      )
    ).toEqual(['full:generated', 'full:src', 'full:README.md']);
  });
});
