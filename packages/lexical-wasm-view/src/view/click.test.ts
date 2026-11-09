/** @vitest-environment jsdom */

import { Access } from '@macro-inc/collaboration/session/abi.generated';
import { beforeAll, expect, test } from 'vitest';
import { CLICK_COMMAND } from './commands';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from './test/native-surface';
import type { ViewSelection } from './types';

beforeAll(initializeNativeSurfaceTests);

test('Click admits the actual first DOM range before component listeners and keeps equations unselected', () => {
  const fixture = nativeSurface();
  try {
    // This event-routing fixture needs an actual native equation node and its
    // DOM target; the app's retained Equation component is tested in browsers.
    fixture.view.registry.register('equation', {
      createDOM: (_node, context) => context.document.createElement('div'),
      updateDOM: () => false,
    });
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'text target' }],
            },
            {
              type: 'paragraph',
              version: 1,
              children: [
                {
                  type: 'equation',
                  version: 1,
                  equation: 'x^2',
                  inline: false,
                },
              ],
            },
          ],
        },
      })
    );
    const leaf = [...fixture.view.mirror.values()].find(
      (node) => node.text === 'text target'
    );
    const equation = [...fixture.view.mirror.values()].find(
      (node) => node.type === 'equation'
    );
    if (!leaf || !equation) throw new Error('Missing actual nodes');
    const leafDOM = fixture.view.getElementByKey(leaf.key)?.firstChild;
    const equationDOM = fixture.view.getElementByKey(equation.key);
    if (!leafDOM || !equationDOM) throw new Error('Missing actual DOM');
    fixture.port.selectionFromView({ kind: 'none' });
    document.getSelection()?.setBaseAndExtent(leafDOM, 2, leafDOM, 2);
    let before = false;
    let beforeSelection: ViewSelection | undefined;
    const stop = fixture.view.registerViewCommand(
      CLICK_COMMAND,
      () => {
        before = true;
        beforeSelection = fixture.view.selection().selection;
        return false;
      },
      4
    );
    equationDOM.dispatchEvent(
      new MouseEvent('click', { bubbles: true, detail: 1 })
    );
    stop();
    expect(before).toBe(true);
    expect(beforeSelection).toEqual({
      kind: 'range',
      anchor: { key: leaf.key, type: 'text', offset: 2 },
      focus: { key: leaf.key, type: 'text', offset: 2 },
    });
    expect(fixture.view.selection().selection.kind).toBe('range');
  } finally {
    fixture.close();
  }
});

test('ordinary mouse Click clears native NodeSelection before lower-priority listeners', () => {
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
              children: [{ type: 'text', version: 1, text: 'text target' }],
            },
          ],
        },
      })
    );
    const paragraph = [...fixture.view.mirror.values()].find(
      (node) => node.type === 'paragraph'
    );
    if (!paragraph) throw new Error('Missing actual paragraph');
    const dom = fixture.view.getElementByKey(paragraph.key);
    if (!dom) throw new Error('Missing actual DOM');
    fixture.port.selectionFromView({ kind: 'node', keys: [paragraph.key] });
    document.getSelection()?.setBaseAndExtent(dom, 0, dom, 0);
    let after = 0;
    const original = fixture.view.runViewCommand.bind(fixture.view);
    fixture.view.runViewCommand = (name, payload, phase) => {
      if (name === 'Click' && phase === 'after') after++;
      return original(name, payload, phase);
    };
    dom.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    const selection = fixture.view.selection().selection;
    expect(selection.kind === 'node' ? selection.keys : []).toEqual([]);
    expect(after).toBe(0);
  } finally {
    fixture.close();
  }
});

test.each(['touch', 'pen'])(
  '%s Click resolves the actual DOM range after a node selection',
  (pointerType) => {
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
                children: [{ type: 'text', version: 1, text: 'text target' }],
              },
            ],
          },
        })
      );
      const leaf = [...fixture.view.mirror.values()].find(
        (node) => node.text === 'text target'
      );
      if (!leaf || leaf.parent === null) throw new Error('Missing actual text');
      const dom = fixture.view.getElementByKey(leaf.key);
      const text = dom?.firstChild;
      if (!dom || !text) throw new Error('Missing actual DOM');
      fixture.port.selectionFromView({ kind: 'node', keys: [leaf.parent] });
      document.getSelection()?.setBaseAndExtent(text, 3, text, 3);
      const event = new MouseEvent('click', { bubbles: true, detail: 1 });
      Object.defineProperty(event, 'pointerType', { value: pointerType });
      dom.dispatchEvent(event);
      expect(fixture.view.selection().selection).toEqual({
        kind: 'range',
        anchor: { key: leaf.key, type: 'text', offset: 3 },
        focus: { key: leaf.key, type: 'text', offset: 3 },
      });
    } finally {
      fixture.close();
    }
  }
);

test('a higher-priority component listener owns explicit node selection and consumes Click', () => {
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
              children: [{ type: 'text', version: 1, text: 'text target' }],
            },
          ],
        },
      })
    );
    const paragraph = [...fixture.view.mirror.values()].find(
      (node) => node.type === 'paragraph'
    );
    if (!paragraph) throw new Error('Missing actual paragraph');
    const dom = fixture.view.getElementByKey(paragraph.key);
    if (!dom) throw new Error('Missing actual DOM');
    document.getSelection()?.removeAllRanges();
    const stop = fixture.view.registerViewCommand(
      CLICK_COMMAND,
      () => {
        fixture.port.selectionFromView({ kind: 'node', keys: [paragraph.key] });
        return true;
      },
      1
    );
    fixture.counters.admissions = 0;
    dom.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    stop();
    expect(fixture.view.selection().selection).toEqual({
      kind: 'node',
      keys: [paragraph.key],
    });
    expect(fixture.counters.admissions).toBe(1);
  } finally {
    fixture.close();
  }
});

test('a real read-only Click clears cached node selection while preserving the browser range', () => {
  const fixture = nativeSurface(Access.Read);
  try {
    expect(fixture.view.node(0)?.kind).toBe('root');
    expect(fixture.root.contentEditable).toBe('false');
    fixture.port.selectionFromView({ kind: 'node', keys: [0] });
    expect(fixture.view.selection().selection).toEqual({
      kind: 'node',
      keys: [0],
    });
    document.getSelection()?.setBaseAndExtent(fixture.root, 0, fixture.root, 0);
    fixture.root.dispatchEvent(
      new MouseEvent('click', { bubbles: true, detail: 1 })
    );
    const selection = fixture.view.selection().selection;
    expect(selection.kind === 'node' ? selection.keys : []).toEqual([]);
    expect(document.getSelection()?.anchorNode).toBe(fixture.root);
    expect(document.getSelection()?.focusNode).toBe(fixture.root);
    expect(document.getSelection()?.rangeCount).toBe(1);
  } finally {
    fixture.close();
  }
});
