import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { $setId } from '@macro-inc/lexical-core';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  blameTooltipPlugin,
  createBlameTooltipStore,
} from '../plugins/blame-tooltip/blameTooltipPlugin';
import { behaviorEditor } from './editor';

// Supply only the pointing-device boundary; resolve real mounted nodes/IDs.
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: vi.fn(() => false),
}));

beforeEach(() => {
  vi.mocked(isTouchDevice).mockReturnValue(false);
  window.getSelection()?.removeAllRanges();
});

function hoverFixture(
  leafId: string | null = 'leaf-id',
  parentId: string | null = 'parent-id'
) {
  const [state, setState] = createBlameTooltipStore();
  let unregister: (() => void) | undefined;
  const dispose = () => {
    unregister?.();
    unregister = undefined;
  };
  const { editor, root } = behaviorEditor((editor) => {
    unregister = blameTooltipPlugin({ setState })(editor);
    return dispose;
  });
  let key = '';
  editor.update(
    () => {
      const text = $createTextNode('Hover text');
      const paragraph = $createParagraphNode().append(text);
      if (leafId) $setId(text, leafId);
      if (parentId) $setId(paragraph, parentId);
      key = text.getKey();
      $getRoot().append(paragraph);
    },
    { discrete: true }
  );
  const text = editor.getElementByKey(key);
  if (!text) throw new Error('Expected mounted text');
  return { editor, root, text, state, setState, key, dispose };
}

function pointerMove(target: HTMLElement) {
  target.dispatchEvent(
    new MouseEvent('pointermove', { bubbles: true, clientX: 37, clientY: 61 })
  );
}

describe('blame hover node policy', () => {
  it('resolves the nearest stable text id and records pointer coordinates', () => {
    const { text, state } = hoverFixture();
    pointerMove(text);
    expect({ ...state }).toEqual({
      hovering: true,
      nodeId: 'leaf-id',
      x: 37,
      y: 61,
    });
  });

  it('falls back to the stable paragraph id for text without its own id', () => {
    const { text, state } = hoverFixture(null);
    pointerMove(text);
    expect(state.nodeId).toBe('parent-id');
    expect(state.hovering).toBe(true);
  });

  it('dismisses when neither text nor its ancestors has a stable id', () => {
    const { text, state, setState } = hoverFixture(null, null);
    setState({ hovering: true, nodeId: 'previous-id' });
    pointerMove(text);
    expect(state.hovering).toBe(false);
    expect(state.nodeId).toBeNull();
  });

  it('does not offer blame for a paragraph background instead of text', () => {
    const { root, state, setState } = hoverFixture();
    setState({ hovering: true, nodeId: 'previous-id' });
    const paragraph = root.querySelector('p');
    if (!paragraph) throw new Error('Expected mounted paragraph');
    pointerMove(paragraph);
    expect(state.hovering).toBe(false);
    expect(state.nodeId).toBeNull();
  });

  it('dismisses a pointer event targeting SVG rather than an HTML element', () => {
    const { root, state, setState } = hoverFixture();
    setState({ hovering: true, nodeId: 'previous-id' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    root.append(svg);
    svg.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    svg.remove();
    expect(state.hovering).toBe(false);
    expect(state.nodeId).toBeNull();
  });

  it.each([false, true])(
    'suppresses a nonempty native selection=%s',
    (expanded) => {
      const { text, state } = hoverFixture();
      const child = text.firstChild;
      if (!child) throw new Error('Expected DOM text');
      const range = document.createRange();
      range.setStart(child, 0);
      range.setEnd(child, expanded ? 5 : 0);
      window.getSelection()?.addRange(range);
      pointerMove(text);
      expect(state.hovering).toBe(!expanded);
      expect(state.nodeId).toBe(expanded ? null : 'leaf-id');
    }
  );

  it('ignores pointer movement on a primary touch device', () => {
    const { text, state } = hoverFixture();
    vi.mocked(isTouchDevice).mockReturnValue(true);
    pointerMove(text);
    expect(state.hovering).toBe(false);
    expect(state.nodeId).toBeNull();
  });

  it.each(['pointerleave', 'pointerdown', 'beforeinput'])(
    'dismisses an existing hover on %s',
    (type) => {
      const { root, text, state } = hoverFixture();
      pointerMove(text);
      expect(state.hovering).toBe(true);
      root.dispatchEvent(new Event(type));
      expect(state.hovering).toBe(false);
      expect(state.nodeId).toBeNull();
    }
  );

  it('dismisses on a nonbubbling scroll captured from a descendant', () => {
    const { text, state } = hoverFixture();
    pointerMove(text);
    expect(state.hovering).toBe(true);
    text.dispatchEvent(new Event('scroll', { bubbles: false }));
    expect(state.hovering).toBe(false);
    expect(state.nodeId).toBeNull();
  });

  it('moves pointer listeners to a replacement root and detaches the previous root', () => {
    const { editor, root, key, state } = hoverFixture();
    const replacement = document.createElement('div');
    replacement.contentEditable = 'true';
    document.body.append(replacement);
    try {
      editor.setRootElement(replacement);
      const text = editor.getElementByKey(key);
      if (!text) throw new Error('Expected remounted text');
      pointerMove(text);
      expect(state.hovering).toBe(true);
      root.dispatchEvent(new Event('pointerleave'));
      expect(state.hovering).toBe(true);
      replacement.dispatchEvent(new Event('pointerleave'));
      expect(state.hovering).toBe(false);
    } finally {
      replacement.remove();
    }
  });

  it('unregisters root pointer and document scroll listeners on disposal', () => {
    const { root, text, state, setState, dispose } = hoverFixture();
    pointerMove(text);
    expect(state.hovering).toBe(true);
    dispose();
    root.dispatchEvent(new Event('pointerleave'));
    document.dispatchEvent(new Event('scroll'));
    expect(state.hovering).toBe(true);
    setState({ hovering: false, nodeId: null });
    pointerMove(text);
    expect(state.hovering).toBe(false);
    expect(state.nodeId).toBeNull();
  });
});
