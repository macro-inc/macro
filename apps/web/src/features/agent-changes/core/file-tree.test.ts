import { describe, expect, it } from 'vitest';
import type { ChangedFile } from './changeset';
import { buildFileTree, flattenFiles } from './file-tree';

function file(path: string): ChangedFile {
  return {
    path,
    kind: 'modified',
    additions: 1,
    deletions: 0,
    binary: false,
    patchOmitted: false,
  };
}

describe('buildFileTree', () => {
  it('compresses single-child directory chains', () => {
    const tree = buildFileTree([
      file('apps/web/src/a.ts'),
      file('apps/web/src/b.ts'),
    ]);
    expect(tree).toHaveLength(1);
    const dir = tree[0]!;
    expect(dir.kind).toBe('dir');
    if (dir.kind !== 'dir') return;
    expect(dir.name).toBe('apps/web/src');
    expect(dir.path).toBe('apps/web/src');
    expect(dir.children.map((child) => child.name)).toEqual(['a.ts', 'b.ts']);
  });

  it('stops compressing where the tree branches', () => {
    const tree = buildFileTree([
      file('apps/web/src/a.ts'),
      file('apps/web/test/b.ts'),
      file('crates/x/src/lib.rs'),
    ]);
    expect(tree.map((node) => node.name)).toEqual(['apps/web', 'crates/x/src']);
    const web = tree[0]!;
    if (web.kind !== 'dir') throw new Error('expected dir');
    expect(web.children.map((node) => node.name)).toEqual(['src', 'test']);
  });

  it('lists directories before files and keeps patch order', () => {
    const tree = buildFileTree([
      file('README.md'),
      file('docs/guide.md'),
      file('LICENSE'),
    ]);
    expect(tree.map((node) => `${node.kind}:${node.name}`)).toEqual([
      'dir:docs',
      'file:README.md',
      'file:LICENSE',
    ]);
  });

  it('flattens back to the files in display order', () => {
    const files = [file('b/y.ts'), file('a.ts'), file('b/x.ts')];
    expect(flattenFiles(buildFileTree(files)).map((f) => f.path)).toEqual([
      'b/y.ts',
      'b/x.ts',
      'a.ts',
    ]);
  });
});
