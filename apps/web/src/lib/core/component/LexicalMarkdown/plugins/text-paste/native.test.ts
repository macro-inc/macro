/** @vitest-environment jsdom */

import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
  transfer,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { beforeAll, expect, test, vi } from 'vitest';

const { lookup, cached } = vi.hoisted(() => ({
  lookup: vi.fn<(key: string) => Promise<{ id: string } | null>>(),
  cached: vi.fn<(key: string) => { id: string } | undefined>(),
}));
vi.mock('@queries/storage/pr-mention', () => ({
  fetchPullRequestByGithubKey: lookup,
  getCachedPullRequestByGithubKey: cached,
}));

import { registerNativeTextPaste } from './native';

beforeAll(initializeNativeSurfaceTests);

test('native PR paste uses one admission and asynchronously upgrades only its placeholder', async () => {
  const fixture = nativeSurface();
  fixture.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [{ type: 'paragraph', version: 1, children: [] }],
      },
    })
  );
  const paragraph = fixture.root.firstElementChild;
  if (!paragraph) throw new Error('Missing paragraph');
  fixture.root.focus();
  document.getSelection()?.setBaseAndExtent(paragraph, 0, paragraph, 0);
  registerMacroDecoratorViews(fixture.view.registry, {
    'pr-mention': () => null,
  });
  let resolve: ((value: { id: string } | null) => void) | undefined;
  const deferred = new Promise<{ id: string } | null>((done) => {
    resolve = done;
  });
  lookup.mockReturnValue(deferred);
  cached.mockReturnValue(undefined);
  const release = registerNativeTextPaste(fixture.view);
  try {
    const before = fixture.counters.admissions;
    expect(
      await fixture.view.clipboard.paste(
        transfer('https://github.com/example/repository/pull/12/files')
      )
    ).toBe(true);
    expect(fixture.counters.admissions - before).toBe(1);
    expect(lookup).toHaveBeenLastCalledWith('example/repository/pull/12');
    expect(fixture.root.querySelector('a')?.getAttribute('href')).toBe(
      'https://github.com/example/repository/pull/12/files'
    );
    if (!resolve) throw new Error('Missing lookup resolver');
    resolve({ id: 'fixture-pr' });
    await deferred;
    expect(fixture.root.querySelector('a')).toBeNull();
    expect(
      [...fixture.view.mirror.values()].some(
        (node) => node.type === 'pr-mention'
      )
    ).toBe(true);
    expect(fixture.counters.admissions - before).toBe(2);
  } finally {
    release();
    fixture.close();
  }
});

test('disposed paste transport never submits a late lookup result', async () => {
  const fixture = nativeSurface();
  fixture.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [{ type: 'paragraph', version: 1, children: [] }],
      },
    })
  );
  const paragraph = fixture.root.firstElementChild;
  if (!paragraph) throw new Error('Missing paragraph');
  fixture.root.focus();
  document.getSelection()?.setBaseAndExtent(paragraph, 0, paragraph, 0);
  let resolve: ((value: { id: string } | null) => void) | undefined;
  const deferred = new Promise<{ id: string } | null>((done) => {
    resolve = done;
  });
  lookup.mockReturnValue(deferred);
  cached.mockReturnValue(undefined);
  const release = registerNativeTextPaste(fixture.view);
  try {
    await fixture.view.clipboard.paste(
      transfer('https://github.com/example/repository/pull/12')
    );
    const before = fixture.counters.admissions;
    release();
    if (!resolve) throw new Error('Missing lookup resolver');
    resolve({ id: 'fixture-pr' });
    await deferred;
    expect(fixture.counters.admissions).toBe(before);
    expect(fixture.root.querySelector('a')).not.toBeNull();
  } finally {
    fixture.close();
  }
});
