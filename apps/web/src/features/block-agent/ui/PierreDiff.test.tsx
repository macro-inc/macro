/** @vitest-environment jsdom */

import { cleanup, render as renderComponent } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PierreDiff } from './PierreDiff';

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  cleanUp: vi.fn(),
  construct: vi.fn(),
  pool: {},
}));
vi.mock('@pierre/diffs', () => ({
  FileDiff: class {
    constructor(...args: unknown[]) {
      mocks.construct(...args);
    }
    render = mocks.render;
    cleanUp = mocks.cleanUp;
    setThemeType = vi.fn();
  },
}));
vi.mock('./diff-workers', () => ({
  useDiffWorkers: () => () => ({ kind: 'ready', pool: mocks.pool }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PierreDiff', () => {
  it('uses the worker pool and isolates same-path edits and streaming revisions', () => {
    const [newText, setNewText] = createSignal('const value = 2;');
    const view = renderComponent(() => (
      <PierreDiff
        diffs={[
          { path: 'file.ts', oldText: 'const value = 1;', newText: newText() },
          {
            path: 'file.ts',
            oldText: 'const value = 2;',
            newText: 'const value = 3;',
          },
          { path: 'file.ts', oldText: null, newText: 'const value = 4;' },
        ]}
      />
    ));
    expect(mocks.construct).toHaveBeenCalledTimes(3);
    for (const args of mocks.construct.mock.calls) {
      expect(args[1]).toBe(mocks.pool);
    }
    const initialKeys = mocks.render.mock.calls.map(
      ([args]) => args.newFile.cacheKey
    );
    expect(new Set(initialKeys).size).toBe(3);
    expect(mocks.render.mock.calls[2][0].oldFile).toBeNull();
    setNewText('const value = 5;');
    const changed = mocks.render.mock.calls.findLast(
      ([args]) => args.newFile.contents === 'const value = 5;'
    );
    expect(changed).toBeDefined();
    expect(initialKeys).not.toContain(changed![0].newFile.cacheKey);
    expect(changed![0].oldFile.cacheKey).not.toBe(changed![0].newFile.cacheKey);
    view.unmount();
    expect(mocks.cleanUp.mock.calls.length).toBe(
      mocks.construct.mock.calls.length
    );
  });

  it('retains the size limit for main-thread diff and DOM work', () => {
    const view = renderComponent(() => (
      <PierreDiff
        diffs={[{ path: 'large.ts', oldText: '', newText: '\n'.repeat(2000) }]}
      />
    ));
    expect(view.getByText('large diff (2,001 lines)')).toBeTruthy();
    expect(mocks.construct).not.toHaveBeenCalled();
  });
});
