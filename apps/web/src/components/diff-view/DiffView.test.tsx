import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, For, type JSX } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { DiffView } from './DiffView';
import type { DiffFile } from './model/diff-file';
import type { LineAnnotation, LineRange } from './model/lines';

// Pierre mounts a custom element and highlights with shiki; these tests cover
// everything around it and leave the diff body to the browser.
vi.mock('./pierre/PierreFileDiff', () => ({
  PierreFileDiff: (props: {
    path: string;
    annotations: LineAnnotation[];
    renderAnnotation: (key: string) => JSX.Element;
    onSelectLines?: (range: LineRange) => void;
  }) => (
    <div
      data-testid="diff"
      data-path={props.path}
      data-selectable={String(props.onSelectLines !== undefined)}
    >
      <For each={props.annotations}>
        {(annotation) => props.renderAnnotation(annotation.key)}
      </For>
    </div>
  ),
}));

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 export { a, b };
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

const FILES = [file({}), file({ path: 'img.png', binary: true })];

describe('DiffView', () => {
  it('draws each file with a default header and explains missing diffs', () => {
    render(() => (
      <DiffView.Root files={FILES} patch={PATCH} diffStyle="unified">
        <DiffView.Stack />
      </DiffView.Root>
    ));
    expect(screen.getAllByTestId('diff')).toHaveLength(1);
    expect(screen.getByText('Binary file')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide a.ts' })).toBeTruthy();
    expect(screen.getByTestId('diff').dataset.selectable).toBe('false');
  });

  it('collapses one file from its header and all of them from the toolbar', () => {
    render(() => (
      <DiffView.Root files={FILES} patch={PATCH} diffStyle="unified">
        <DiffView.CollapseAll />
        <DiffView.Stack />
      </DiffView.Root>
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Hide a.ts' }));
    expect(screen.queryAllByTestId('diff')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Show a.ts' }));
    expect(screen.getAllByTestId('diff')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryAllByTestId('diff')).toHaveLength(0);
    expect(screen.queryByText('Binary file')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getAllByTestId('diff')).toHaveLength(1);
  });

  it("uses the host's header and hangs its annotations under the file", () => {
    const picked: LineRange[] = [];
    render(() => (
      <DiffView.Root files={FILES} patch={PATCH} diffStyle="unified">
        <DiffView.Stack
          header={(entry) => (
            <>
              <DiffView.FilePath />
              <button type="button">{`Copy ${entry.file.path}`}</button>
            </>
          )}
          annotations={(entry) =>
            entry.file.path === 'src/a.ts'
              ? [{ key: 'additions:2', side: 'additions', lineNumber: 2 }]
              : []
          }
          renderAnnotation={(entry, key) => (
            <span>{`${entry.file.path} at ${key}`}</span>
          )}
          onSelectLines={(range) => void picked.push(range)}
        />
      </DiffView.Root>
    ));
    expect(screen.getByRole('button', { name: 'Copy src/a.ts' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hide a.ts' })).toBeNull();
    const diff = screen.getByTestId('diff');
    expect(diff.textContent).toBe('src/a.ts at additions:2');
    expect(diff.dataset.selectable).toBe('true');
  });

  it("puts the host's aside beside each file's diff, and hides it with the diff", () => {
    render(() => (
      <DiffView.Root files={FILES} patch={PATCH} diffStyle="unified">
        <DiffView.Stack
          aside={(entry) => <aside>{`Margin for ${entry.file.path}`}</aside>}
        />
      </DiffView.Root>
    ));
    expect(screen.getByText('Margin for src/a.ts')).toBeTruthy();
    expect(screen.getByText('Margin for img.png')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide a.ts' }));
    expect(screen.queryByText('Margin for src/a.ts')).toBeNull();
  });

  it("follows a host's own collapse state", () => {
    const [collapsed, setCollapsed] = createSignal(true);
    render(() => (
      <DiffView.Root
        files={FILES}
        patch={PATCH}
        diffStyle="unified"
        collapse={{
          isCollapsed: () => collapsed(),
          toggle: () => setCollapsed((value) => !value),
          toggleAll: () => setCollapsed((value) => !value),
          anyExpanded: () => !collapsed(),
        }}
      >
        <DiffView.Stack />
      </DiffView.Root>
    ));
    expect(screen.queryAllByTestId('diff')).toHaveLength(0);
    setCollapsed(false);
    expect(screen.getAllByTestId('diff')).toHaveLength(1);
  });
});
