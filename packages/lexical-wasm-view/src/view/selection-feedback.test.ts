/** @vitest-environment jsdom */
import { beforeAll, expect, test } from 'vitest';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from './test/native-surface';
beforeAll(initializeNativeSurfaceTests);

test('native caret movement publishes derived typing attributes', () => {
  const fixture = nativeSurface();
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [
                { type: 'text', version: 1, text: 'plain' },
                {
                  type: 'text',
                  version: 1,
                  text: 'styled',
                  format: 1,
                  style: 'color: red;',
                },
              ],
            },
          ],
        },
      })
    );
    const leaves = [...fixture.view.mirror.values()].filter(
      (node) => node.kind === 'text'
    );
    const plain = leaves.find((node) => node.text === 'plain');
    const styled = leaves.find((node) => node.text === 'styled');
    if (!plain || !styled) throw new Error('Missing text fixture');
    for (const key of [plain.key, styled.key])
      fixture.port.selectionFromView({
        kind: 'range',
        anchor: { key, type: 'text', offset: 2 },
        focus: { key, type: 'text', offset: 2 },
      });
    expect(fixture.view.selection().format).toBe(1);
    expect(fixture.view.selection().style).toBe('color: red;');
  } finally {
    fixture.close();
  }
});

test('authoritative selection feedback caches points without writing DOM under skip-dom-selection', () => {
  const fixture = nativeSurface();
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [
                { type: 'text', version: 1, text: 'styled', format: 1 },
              ],
            },
          ],
        },
      })
    );
    const leaf = [...fixture.view.mirror.values()].find(
      (node) => node.text === 'styled'
    );
    const text = document
      .createTreeWalker(fixture.root, NodeFilter.SHOW_TEXT)
      .nextNode();
    if (!leaf || !text) throw new Error('Missing styled text');
    fixture.root.focus();
    document.getSelection()?.setBaseAndExtent(text, 0, text, 0);
    const apply = fixture.view.apply.bind(fixture.view);
    fixture.view.apply = (words, strings, effects = []) => {
      const selection = effects.find(
        (effect) => effect.kind === 6 && effect.code === 0
      );
      if (!selection) throw new Error('Missing authoritative selection');
      apply(words, strings, [
        ...effects,
        { ...selection, kind: 11, keys: ['skip-dom-selection'] },
      ]);
    };
    fixture.port.selectionFromView({
      kind: 'range',
      anchor: { key: leaf.key, type: 'text', offset: 3 },
      focus: { key: leaf.key, type: 'text', offset: 3 },
    });
    expect(fixture.view.selection().selection).toEqual({
      kind: 'range',
      anchor: { key: leaf.key, type: 'text', offset: 3 },
      focus: { key: leaf.key, type: 'text', offset: 3 },
    });
    expect(document.getSelection()?.anchorOffset).toBe(0);
    expect(document.getSelection()?.focusOffset).toBe(0);
    expect(fixture.view.selection().format).toBe(1);
  } finally {
    fixture.close();
  }
});

test('an exact unformatted caret keeps zero-output acknowledgement and one admission', () => {
  const fixture = nativeSurface();
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'plain' }],
            },
          ],
        },
      })
    );
    const leaf = [...fixture.view.mirror.values()].find(
      (node) => node.text === 'plain'
    );
    if (!leaf) throw new Error('Missing plain text');
    const selection = {
      kind: 'range' as const,
      anchor: { key: leaf.key, type: 'text' as const, offset: 1 },
      focus: { key: leaf.key, type: 'text' as const, offset: 1 },
    };
    fixture.port.selectionFromView(selection);
    const input = fixture.session.selectionFromView.bind(fixture.session);
    let flags = -1;
    fixture.session.selectionFromView = (...args) => {
      flags = input(...args);
      return flags;
    };
    fixture.session.query = () => {
      throw new Error('Unexpected query');
    };
    fixture.session.nodeText = () => {
      throw new Error('Unexpected node query');
    };
    fixture.counters.admissions = 0;
    const moved = {
      ...selection,
      anchor: { ...selection.anchor, offset: 2 },
      focus: { ...selection.focus, offset: 2 },
    };
    fixture.port.selectionFromView(moved);
    expect(flags).toBe(0);
    expect(fixture.counters.admissions).toBe(1);
    expect(fixture.view.selection().selection).toEqual(moved);
  } finally {
    fixture.close();
  }
});
