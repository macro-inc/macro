import type * as Pierre from '@pierre/diffs';
import type { FileDiffOptions } from '@pierre/diffs';
import {
  createComponent,
  createContext,
  onCleanup,
  useContext,
} from 'solid-js';
import { render } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';
import { PierreFileDiff } from '../pierre/PierreFileDiff';
import type { DiffFile } from './diff-file';
import { matchFilesToDiffs, parsePatch } from './patch';

const renderer = vi.hoisted(() => {
  let resolve: ((options: FileDiffOptions<string>) => void) | undefined;
  const ready = new Promise<FileDiffOptions<string>>((done) => {
    resolve = done;
  });
  return {
    ready,
    capture: (options: FileDiffOptions<string>) => resolve?.(options),
  };
});

vi.mock('@pierre/diffs', async (importOriginal) => {
  const actual = await importOriginal<typeof Pierre>();
  return {
    ...actual,
    FileDiff: class {
      constructor(options: FileDiffOptions<string>) {
        renderer.capture(options);
      }
      setOptions() {}
      render() {}
      setSelectedLines() {}
      setThemeType() {}
      cleanUp() {}
    },
  };
});

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

function file(overrides: Partial<DiffFile>): DiffFile {
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

describe('diff annotation ownership', () => {
  it('keeps provider context and cleanup when Pierre renders after the mount turn', async () => {
    const diff = parsePatch(PATCH).get('src/a.ts');
    if (!diff) throw new Error('Missing parsed fixture');
    const Context = createContext<string>();
    const cleaned = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    const dispose = render(
      () =>
        createComponent(Context.Provider, {
          value: 'owned',
          get children() {
            return createComponent(PierreFileDiff, {
              path: 'src/a.ts',
              diff,
              diffStyle: 'unified',
              themeType: 'dark',
              annotations: [],
              selection: undefined,
              renderAnnotation: () => {
                const value = useContext(Context);
                onCleanup(cleaned);
                return value ?? 'missing';
              },
            });
          },
        }),
      container
    );
    try {
      const options = await renderer.ready;
      if (!options.renderAnnotation)
        throw new Error('Missing annotation renderer');
      const element = options.renderAnnotation({
        side: 'additions',
        lineNumber: 1,
        metadata: 'example',
      });
      expect(element?.textContent).toBe('owned');
    } finally {
      dispose();
      container.remove();
    }
    expect(cleaned).toHaveBeenCalledOnce();
  });
});
