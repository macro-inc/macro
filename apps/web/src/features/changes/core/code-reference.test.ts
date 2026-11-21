import { describe, expect, it } from 'vitest';
import type { ChangedFile } from './changeset';
import {
  findChangedFile,
  headBlobUrl,
  linkCodeReferences,
  parseCodeReference,
} from './code-reference';

const files: ChangedFile[] = [
  {
    path: 'apps/web/src/pane.tsx',
    kind: 'modified',
    additions: 4,
    deletions: 1,
    binary: false,
    patchOmitted: false,
  },
  {
    path: 'src/pane.tsx',
    kind: 'added',
    additions: 10,
    deletions: 0,
    binary: false,
    patchOmitted: false,
  },
  {
    path: 'crates/agent/src/lib.rs',
    kind: 'modified',
    additions: 2,
    deletions: 2,
    binary: false,
    patchOmitted: false,
  },
  {
    path: 'package.json',
    kind: 'modified',
    additions: 1,
    deletions: 1,
    binary: false,
    patchOmitted: false,
  },
  {
    path: 'app/(group)/page.tsx',
    kind: 'added',
    additions: 3,
    deletions: 0,
    binary: false,
    patchOmitted: false,
  },
  {
    path: 'Makefile',
    kind: 'modified',
    additions: 1,
    deletions: 0,
    binary: false,
    patchOmitted: false,
  },
];

describe('parseCodeReference', () => {
  it('reads paths with GitHub and colon line suffixes', () => {
    expect(parseCodeReference('src/pane.tsx')).toEqual({
      path: 'src/pane.tsx',
    });
    expect(parseCodeReference('./src/pane.tsx#L12')).toEqual({
      path: 'src/pane.tsx',
      lines: { start: 12, end: 12 },
    });
    expect(parseCodeReference('src/pane.tsx#L12-L20')).toEqual({
      path: 'src/pane.tsx',
      lines: { start: 12, end: 20 },
    });
    expect(parseCodeReference('src/pane.tsx#L12C3-L20C1')).toEqual({
      path: 'src/pane.tsx',
      lines: { start: 12, end: 20 },
    });
    expect(parseCodeReference('src/pane.tsx:12')).toEqual({
      path: 'src/pane.tsx',
      lines: { start: 12, end: 12 },
    });
    expect(parseCodeReference('src/pane.tsx:12:5')).toEqual({
      path: 'src/pane.tsx',
      lines: { start: 12, end: 12 },
    });
    expect(parseCodeReference('package.json:5')).toEqual({
      path: 'package.json',
      lines: { start: 5, end: 5 },
    });
    expect(parseCodeReference('src/pane.tsx:20-12')).toEqual({
      path: 'src/pane.tsx',
      lines: { start: 20, end: 20 },
    });
    expect(
      parseCodeReference('file:///home/u/repo/src/my%20pane.tsx#L3')
    ).toEqual({
      path: '/home/u/repo/src/my pane.tsx',
      lines: { start: 3, end: 3 },
    });
  });

  it('rejects links that are not to code', () => {
    expect(parseCodeReference('https://github.com/a/b/blob/main/x.ts')).toBe(
      undefined
    );
    expect(parseCodeReference('mailto:someone@example.com')).toBe(undefined);
    expect(parseCodeReference('data:text/plain,1')).toBe(undefined);
    expect(parseCodeReference('//cdn.example.com/x.js')).toBe(undefined);
    expect(parseCodeReference('docs/guide.md#setup')).toBe(undefined);
    expect(parseCodeReference('two words.ts')).toBe(undefined);
    expect(parseCodeReference('src/')).toBe(undefined);
    expect(parseCodeReference('')).toBe(undefined);
  });
});

describe('findChangedFile', () => {
  it('prefers an exact match', () => {
    expect(findChangedFile('src/pane.tsx', files)?.path).toBe('src/pane.tsx');
  });

  it('matches an absolute checkout path by its longest changed suffix', () => {
    expect(
      findChangedFile('/home/u/macro/apps/web/src/pane.tsx', files)?.path
    ).toBe('apps/web/src/pane.tsx');
    expect(findChangedFile('/home/u/macro/src/other.tsx', files)).toBe(
      undefined
    );
  });

  it('matches a path written from a subdirectory only when one file ends in it', () => {
    expect(findChangedFile('agent/src/lib.rs', files)?.path).toBe(
      'crates/agent/src/lib.rs'
    );
    expect(findChangedFile('pane.tsx', files)).toBe(undefined);
  });
});

describe('headBlobUrl', () => {
  it('links a relative path at the head commit', () => {
    expect(
      headBlobUrl(
        {
          repository: 'https://github.com/macro-inc/macro',
          head: { name: 'feature', sha: 'abc123' },
        },
        { path: 'docs/a b.md', lines: { start: 3, end: 9 } }
      )
    ).toBe(
      'https://github.com/macro-inc/macro/blob/abc123/docs/a%20b.md#L3-L9'
    );
  });

  it('gives up without a repository, a head commit, or for an absolute path', () => {
    const changeset = {
      repository: 'https://github.com/macro-inc/macro',
      head: { sha: 'abc123' },
    };
    expect(headBlobUrl(undefined, { path: 'docs/a.md' })).toBe(undefined);
    expect(headBlobUrl({ head: { sha: 'abc123' } }, { path: 'a.md' })).toBe(
      undefined
    );
    expect(headBlobUrl(changeset, { path: '/home/u/a.md' })).toBe(undefined);
    expect(headBlobUrl(changeset, { path: '../x/a.md' })).toBe(undefined);
  });
});

describe('linkCodeReferences', () => {
  it('links inline code that names a changed file, keeping it as code', () => {
    expect(
      linkCodeReferences(
        'Fixed in `apps/web/src/pane.tsx:12-14` and `Makefile`, see `lib.rs`.',
        files
      )
    ).toBe(
      'Fixed in [`apps/web/src/pane.tsx:12-14`](apps/web/src/pane.tsx#L12-L14) and [`Makefile`](Makefile), see [`lib.rs`](crates/agent/src/lib.rs).'
    );
  });

  it('leaves identifiers, unknown files, links, and fenced code alone', () => {
    const markdown = [
      'Call `pane` from `src/unknown.ts`.',
      'Already [`src/pane.tsx`](src/pane.tsx#L1) linked.',
      '```ts',
      'import x from `src/pane.tsx`;',
      '```',
      '`[src/pane.tsx]` and ``src/pane.tsx``',
    ].join('\n');
    expect(linkCodeReferences(markdown, files)).toBe(markdown);
  });

  it('links a bare file name with a line, and escapes parentheses', () => {
    expect(
      linkCodeReferences(
        'See `package.json:5` and `app/(group)/page.tsx`.',
        files
      )
    ).toBe(
      'See [`package.json:5`](package.json#L5) and [`app/(group)/page.tsx`](app/%28group%29/page.tsx).'
    );
  });

  it('gives links to a changed file a target the markdown import keeps', () => {
    expect(
      linkCodeReferences(
        'In [the pane](file:///home/u/macro/src/pane.tsx#L4) and [pkg](package.json:2), not [docs](https://example.com).',
        files
      )
    ).toBe(
      'In [the pane](src/pane.tsx#L4) and [pkg](package.json#L2), not [docs](https://example.com).'
    );
  });

  it('leaves code inside longer link text, and fences in quotes and lists', () => {
    const markdown = [
      '[the `src/pane.tsx` file](https://example.com/x)',
      '`[a](package.json:2)` shows a link',
      '> ```',
      '> `src/pane.tsx`',
      '> ```',
      '- item',
      '    ```',
      '    `src/pane.tsx`',
      '    ```',
    ].join('\n');
    expect(linkCodeReferences(markdown, files)).toBe(markdown);
  });

  it('leaves code inside the text of every link form', () => {
    const markdown = [
      '[`app/(group)/page.tsx`](app/(group)/page.tsx)',
      '[`src/pane.tsx`](src/pane.tsx "the pane")',
      '[`src/pane.tsx`](<src/pane.tsx>)',
      '[`src/pane.tsx`][1]',
    ].join('\n');
    expect(linkCodeReferences(markdown, files)).toBe(markdown);
  });

  it('keeps a fence open past a line that only opens one', () => {
    const markdown = '```\n```ts\n`src/pane.tsx`\n```';
    expect(linkCodeReferences(markdown, files)).toBe(markdown);
  });

  it('links again after a closed fence', () => {
    expect(
      linkCodeReferences(
        '~~~\n`src/pane.tsx`\n~~~\nSee `src/pane.tsx:3`.',
        files
      )
    ).toBe(
      '~~~\n`src/pane.tsx`\n~~~\nSee [`src/pane.tsx:3`](src/pane.tsx#L3).'
    );
  });
});
