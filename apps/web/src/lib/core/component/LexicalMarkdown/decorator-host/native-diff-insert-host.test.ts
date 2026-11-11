/** @vitest-environment jsdom */

import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { beforeAll, expect, test } from 'vitest';
import { theme } from '../theme';
import { createNativeDiffInsertContext } from './native-diff-insert-host';

beforeAll(initializeNativeSurfaceTests);

const insert = (markdown: string) => ({
  type: 'diff-insert',
  version: 1,
  markdown,
});

function load(children: readonly object[]) {
  const fixture = nativeSurface();
  // Host-only test: the mounted component is covered by the browser cohort.
  registerMacroDecoratorViews(fixture.view.registry, {
    'diff-insert': () => null,
  });
  fixture.port.setState(
    JSON.stringify({ root: { type: 'root', version: 1, children } })
  );
  return fixture;
}

test('owner reads the parent diff user id from the bound acknowledged view', () => {
  const fixture = load([
    {
      type: 'diff',
      version: 1,
      userId: 'macro|owner@example.com',
      children: [insert('**owned**')],
    },
    {
      type: 'diff',
      version: 1,
      children: [insert('no owner')],
    },
    insert('outside'),
  ]);
  const context = createNativeDiffInsertContext(theme);
  try {
    const root = fixture.view.node(0);
    const [owned, unowned, outside] = root?.children ?? [];
    if (owned === undefined || unowned === undefined || outside === undefined)
      throw new Error('Missing actual diff nodes');
    const keyOf = (diff: number) => {
      const child = fixture.view.node(diff)?.children[0];
      if (child === undefined) throw new Error('Missing diff-insert child');
      return String(child);
    };
    // Unbound: no view is consulted.
    expect(context.host.diffInsert.owner(keyOf(owned))).toBe(null);
    context.bindView(fixture.view);
    expect(context.host.diffInsert.owner(keyOf(owned))).toEqual({
      userId: 'macro|owner@example.com',
    });
    expect(context.host.diffInsert.owner(keyOf(unowned))).toEqual({
      userId: undefined,
    });
    expect(context.host.diffInsert.owner(String(outside))).toBe(null);
    // The diff element itself is not a diff-insert.
    expect(context.host.diffInsert.owner(String(owned))).toBe(null);
    for (const key of ['', '-1', '01', '1.5', 'root'])
      expect(context.host.diffInsert.owner(key)).toBe(null);
    context.dispose();
    expect(context.host.diffInsert.owner(keyOf(owned))).toBe(null);
  } finally {
    context.dispose();
    fixture.close();
  }
});
