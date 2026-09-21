import { describe, expect, it } from 'vitest';
import type { ChangedFile } from './changeset';
import { matchFilesToDiffs, parsePatch } from './patch';

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 export { a, b };
diff --git a/old.txt b/new.txt
similarity index 100%
rename from old.txt
rename to new.txt
`;

function file(overrides: Partial<ChangedFile>): ChangedFile {
  return {
    path: 'src/a.ts',
    kind: 'modified',
    additions: 1,
    deletions: 1,
    binary: false,
    patchOmitted: false,
    ...overrides,
  };
}

describe('parsePatch', () => {
  it('keys parsed files by their new path', () => {
    const diffs = parsePatch(PATCH);
    expect(diffs.get('src/a.ts')?.type).toBe('change');
    expect(diffs.get('src/a.ts')?.hunks).toHaveLength(1);
    expect(diffs.get('new.txt')?.type).toBe('rename-pure');
  });

  it('is empty for an empty patch', () => {
    expect(parsePatch('   \n').size).toBe(0);
  });
});

describe('matchFilesToDiffs', () => {
  it('pairs files with diffs and explains the ones without', () => {
    const diffs = parsePatch(PATCH);
    const entries = matchFilesToDiffs(
      [
        file({}),
        file({ path: 'img.png', kind: 'added', binary: true }),
        file({ path: 'big.json', patchOmitted: true }),
        file({ path: 'missing.ts' }),
        file({
          path: 'new.txt',
          previousPath: 'old.txt',
          kind: 'renamed',
          additions: 0,
          deletions: 0,
        }),
      ],
      diffs
    );
    expect(entries[0]!.diff?.name).toBe('src/a.ts');
    expect(entries[1]!.note).toBe('Binary file');
    expect(entries[2]!.note).toBe('Diff left out to fit the size budget');
    expect(entries[3]!.note).toBe('No diff text for this file');
    expect(entries[4]!.diff?.type).toBe('rename-pure');
  });
});
