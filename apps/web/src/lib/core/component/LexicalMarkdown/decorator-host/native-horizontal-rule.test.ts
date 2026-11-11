/** @vitest-environment jsdom */

import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
  transfer,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { beforeAll, expect, test } from 'vitest';
import {
  createNativeHorizontalRuleHost,
  createNativeHorizontalRuleViews,
} from './native-horizontal-rule';

beforeAll(initializeNativeSurfaceTests);

test('selection-only commits update the rule outline and remove control without hover', () => {
  const fixture = nativeSurface();
  registerMacroDecoratorViews(
    fixture.view.registry,
    createNativeHorizontalRuleViews(() => {})
  );
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [{ type: 'horizontalrule', version: 1 }],
        },
      })
    );
    const rule = fixture.root.querySelector('.h-10');
    const line = rule?.querySelector('.h-px');
    const key = fixture.view.node(0)?.children[0];
    if (!rule || !line || key === undefined)
      throw new Error('Missing actual horizontal rule');
    expect(line.classList.contains('outline-4')).toBe(false);
    expect(rule.querySelector('button')).toBeNull();

    fixture.port.selectionFromView({ kind: 'node', keys: [key] });
    expect(fixture.view.selection().selection).toEqual({
      kind: 'node',
      keys: [key],
    });
    expect(line.classList.contains('outline-4')).toBe(true);
    expect(rule.querySelector('button')).not.toBeNull();

    fixture.port.selectionFromView({ kind: 'none' });
    expect(fixture.view.selection().selection.kind).toBe('none');
    expect(line.classList.contains('outline-4')).toBe(false);
    expect(rule.querySelector('button')).toBeNull();
  } finally {
    fixture.close();
  }
});

test('actual Macro HTML paste preserves a horizontal rule between paragraphs', async () => {
  const fixture = nativeSurface();
  let bound: EditorView | undefined;
  registerMacroDecoratorViews(
    fixture.view.registry,
    createNativeHorizontalRuleViews((view) => {
      bound = view;
    })
  );
  try {
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
    if (!paragraph) throw new Error('Missing insertion paragraph');
    fixture.root.focus();
    document.getSelection()?.setBaseAndExtent(paragraph, 0, paragraph, 0);
    // Admit the fixture's caret before starting the asynchronous HTML import.
    document.dispatchEvent(new Event('selectionchange'));
    const key = fixture.view.node(0)?.children[0];
    const point = { key, offset: 0, type: 'element' };
    expect(fixture.view.selection().selection).toEqual({
      kind: 'range',
      anchor: point,
      focus: point,
    });
    expect(
      await fixture.view.clipboard.paste(
        transfer('before\n\nafter', '<p>before</p><hr><p>after</p>')
      )
    ).toBe(true);
    expect(
      fixture.view.node(0)?.children.map((key) => fixture.view.node(key)?.type)
    ).toEqual(['paragraph', 'horizontalrule', 'paragraph']);
    expect(fixture.root.textContent).toBe('beforeafter');
    expect(bound).toBe(fixture.view);
    expect(fixture.root.querySelectorAll('.h-10')).toHaveLength(1);
  } finally {
    fixture.close();
  }
});

test('actual horizontal-rule component selects its native node without an editable guard', () => {
  const fixture = nativeSurface();
  let bound: EditorView | undefined;
  registerMacroDecoratorViews(
    fixture.view.registry,
    createNativeHorizontalRuleViews((view) => {
      bound = view;
    })
  );
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [{ type: 'horizontalrule', version: 1 }],
        },
      })
    );
    expect(bound).toBe(fixture.view);
    const rule = fixture.root.querySelector('.h-10');
    if (!rule) throw new Error('Missing actual horizontal-rule component');
    const key = fixture.view.node(0)?.children[0];
    if (key === undefined) throw new Error('Missing native rule');
    fixture.root.contentEditable = 'false';
    rule.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(fixture.view.selection().selection).toEqual({
      kind: 'node',
      keys: [key],
    });
  } finally {
    fixture.close();
  }
});

test('native rule removal uses one admission and preserves sibling component hosts', () => {
  const fixture = nativeSurface();
  let bound: EditorView | undefined;
  registerMacroDecoratorViews(
    fixture.view.registry,
    createNativeHorizontalRuleViews((view) => {
      bound = view;
    })
  );
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            { type: 'horizontalrule', version: 1 },
            { type: 'horizontalrule', version: 1 },
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'after' }],
            },
          ],
        },
      })
    );
    expect(bound).toBe(fixture.view);
    const children = fixture.view.node(0)?.children;
    if (!children || children.length !== 3)
      throw new Error('Missing native fixture children');
    const [first, second, after] = children;
    const host = createNativeHorizontalRuleHost(() => bound);
    const before = fixture.counters.admissions;
    host.horizontalRule.remove(String(first));
    expect(fixture.counters.admissions - before).toBe(1);
    expect(fixture.view.node(first)).toBeNull();
    expect(fixture.view.node(0)?.children).toEqual([second, after]);
    fixture.port.selectionFromView({ kind: 'none' });
    expect(fixture.view.selection().selection.kind).toBe('none');
    const remaining = fixture.root.querySelector('.h-10');
    if (!remaining) throw new Error('Missing surviving rule component');
    const line = remaining.querySelector('.h-px');
    if (!line) throw new Error('Missing surviving rule line');
    expect(line.classList.contains('outline-4')).toBe(false);
    expect(remaining.querySelector('button')).toBeNull();
    remaining.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(fixture.view.selection().selection).toEqual({
      kind: 'node',
      keys: [second],
    });
    expect(line.classList.contains('outline-4')).toBe(true);
    expect(remaining.querySelector('button')).not.toBeNull();
  } finally {
    fixture.close();
  }
});
