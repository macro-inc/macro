import { describe, expect, it } from 'vitest';
import { buildFileTree, visibleNodes } from './build-file-tree';

const tree = (paths: string[]) => buildFileTree(paths, (path) => path);

describe('buildFileTree', () => {
  it('compresses single-child directory chains', () => {
    const nodes = tree(['apps/web/src/a.ts', 'apps/web/src/b.ts']);
    expect(nodes).toHaveLength(1);
    const directory = nodes[0]!;
    if (directory.kind !== 'directory') throw new Error('expected directory');
    expect(directory.name).toBe('apps/web/src');
    expect(directory.path).toBe('apps/web/src');
    expect(directory.children.map((child) => child.name)).toEqual([
      'a.ts',
      'b.ts',
    ]);
  });

  it('stops compressing where the tree branches', () => {
    const nodes = tree([
      'apps/web/src/a.ts',
      'apps/web/test/b.ts',
      'crates/x/src/lib.rs',
    ]);
    expect(nodes.map((node) => node.name)).toEqual([
      'apps/web',
      'crates/x/src',
    ]);
    const web = nodes[0]!;
    if (web.kind !== 'directory') throw new Error('expected directory');
    expect(web.children.map((node) => node.name)).toEqual(['src', 'test']);
  });

  it('lists directories before files and keeps input order', () => {
    const nodes = tree(['README.md', 'docs/guide.md', 'LICENSE']);
    expect(nodes.map((node) => `${node.kind}:${node.name}`)).toEqual([
      'directory:docs',
      'file:README.md',
      'file:LICENSE',
    ]);
  });

  it('keeps each item and its full path on its file', () => {
    const nodes = buildFileTree(
      [{ path: 'a/b.ts', size: 3 }],
      (item) => item.path
    );
    const directory = nodes[0]!;
    if (directory.kind !== 'directory') throw new Error('expected directory');
    expect(directory.children[0]).toEqual({
      kind: 'file',
      name: 'b.ts',
      path: 'a/b.ts',
      item: { path: 'a/b.ts', size: 3 },
    });
  });
});

describe('visibleNodes', () => {
  it('walks open directories in display order and skips closed ones', () => {
    const nodes = tree(['b/y.ts', 'a.ts', 'b/x.ts', 'c/z.ts']);
    const rows = (open: (path: string) => boolean) =>
      visibleNodes(nodes, open).map(
        ({ node, level, parent }) => `${level}:${node.path}:${parent ?? '-'}`
      );
    expect(rows(() => true)).toEqual([
      '1:b:-',
      '2:b/y.ts:b',
      '2:b/x.ts:b',
      '1:c:-',
      '2:c/z.ts:c',
      '1:a.ts:-',
    ]);
    expect(rows((path) => path !== 'b')).toEqual([
      '1:b:-',
      '1:c:-',
      '2:c/z.ts:c',
      '1:a.ts:-',
    ]);
  });
});
