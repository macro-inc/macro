/** @vitest-environment jsdom */

import { $createQuoteNode, QuoteNode } from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isParagraphNode,
  createEditor,
} from 'lexical';
import { createEffect, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ComposerLayoutMode,
  createComposerLayout,
} from './create-composer-layout';

const resize = vi.hoisted(() => ({ notify: () => {} }));
vi.mock('@solid-primitives/resize-observer', () => ({
  createResizeObserver: (_targets: unknown, callback: () => void) => {
    resize.notify = callback;
  },
}));

const cleanups: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame'],
  });
  const original = Object.getOwnPropertyDescriptor(
    Range.prototype,
    'getBoundingClientRect'
  );
  cleanups.push(() => {
    if (original) {
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', original);
    } else {
      Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
    }
  });
  // jsdom has no layout engine. Model text at 10px per character / 20px per
  // line so these tests exercise width changes and observer timing.
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: vi.fn(function (this: Range) {
      const ancestor = this.commonAncestorContainer;
      const box =
        ancestor instanceof HTMLElement ? ancestor : ancestor.parentElement;
      const width = box?.getBoundingClientRect().width ?? 0;
      const textWidth = this.toString().length * 10;
      const lines = Math.max(1, Math.ceil(textWidth / width));
      return new DOMRect(0, 0, Math.min(textWidth, width), lines * 20);
    }),
  });
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup(initialText = '', initialQuote = false) {
  const container = document.createElement('div');
  const element = document.createElement('div');
  element.style.lineHeight = '20px';
  container.append(element);
  document.body.append(container);
  cleanups.push(() => container.remove());
  const editor = createEditor({ nodes: [QuoteNode] });
  const setText = (text: string, quote = false) =>
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append(
            (quote ? $createQuoteNode() : $createParagraphNode()).append(
              $createTextNode(text)
            )
          );
      },
      { discrete: true }
    );
  setText(initialText, initialQuote);
  let containerWidth = 400;
  let controlsWidth = 80;
  // Extra inset on the live editor alone, as while its padding transitions.
  let liveInset = 0;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      if (this.hasAttribute('data-composer-compact'))
        return new DOMRect(0, 0, containerWidth, 60);
      const compact =
        this.closest('[data-composer-compact]')?.getAttribute(
          'data-composer-compact'
        ) === 'true';
      const live = !this.closest('[aria-hidden="true"]');
      return new DOMRect(
        0,
        0,
        containerWidth - (compact ? controlsWidth : 0) - (live ? liveInset : 0),
        20
      );
    }
  );
  return createRoot((dispose) => {
    cleanups.push(dispose);
    const [mode, setMode] = createSignal<ComposerLayoutMode>('auto');
    const layout = createComposerLayout(editor, {
      container: () => container,
      mode,
    });
    const compactStates: boolean[] = [];
    createEffect(() => {
      compactStates.push(layout.isCompact());
      container.setAttribute(
        'data-composer-compact',
        String(layout.isCompact())
      );
    });
    editor.setRootElement(element);
    cleanups.push(() => editor.setRootElement(null));
    return {
      ...layout,
      editor,
      setText,
      setMode,
      compactStates,
      element,
      container,
      dispose,
      setControlsWidth: (width: number) => {
        controlsWidth = width;
        // A control change need not resize an already-expanded container.
        container.append(document.createElement('button'));
      },
      setLiveInset: (width: number) => {
        liveInset = width;
      },
      resize: (width: number) => {
        containerWidth = width;
        resize.notify();
      },
    };
  });
}

async function flushMeasurements() {
  vi.advanceTimersToNextFrame();
  // Includes the second measurement after the layout reacts to wrapping.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('composer layout', () => {
  it('coalesces resize measurements outside observer delivery while keeping edits immediate', async () => {
    const input = setup('a'.repeat(30));
    await flushMeasurements();
    expect(input.isCompact()).toBe(true);
    const measure = vi.mocked(Range.prototype.getBoundingClientRect);
    measure.mockClear();
    input.resize(320);
    input.resize(300);
    await Promise.resolve();
    expect(measure).not.toHaveBeenCalled();
    expect(input.isCompact()).toBe(true);
    await flushMeasurements();
    expect(input.isCompact()).toBe(false);

    input.setText('short');
    await Promise.resolve();
    await Promise.resolve();
    expect(input.isCompact()).toBe(true);
  });

  it('expands for wrapped text without newlines and stays expanded at the wider layout', async () => {
    const input = setup();
    await flushMeasurements();
    expect(input.isCompact()).toBe(true);

    input.setText('a'.repeat(33));
    await flushMeasurements();
    expect(input.isCompact()).toBe(false);
    expect(input.element.getBoundingClientRect().width).toBe(400);
    resize.notify();
    await flushMeasurements();
    expect(input.isCompact()).toBe(false);

    input.setText('short draft');
    await flushMeasurements();
    expect(input.isCompact()).toBe(true);
    expect(document.querySelectorAll('[data-lexical-editor]')).toHaveLength(1);
  });

  it('rechecks the same draft when its container narrows or widens', async () => {
    const input = setup('a'.repeat(30));
    await flushMeasurements();
    expect(input.isCompact()).toBe(true);
    input.resize(300);
    await flushMeasurements();
    expect(input.isCompact()).toBe(false);
    input.resize(500);
    await flushMeasurements();
    expect(input.isCompact()).toBe(true);
  });

  it('measures restored content when the editor connects', async () => {
    const input = setup('a'.repeat(50));
    await flushMeasurements();
    expect(input.isCompact()).toBe(false);
    input.setText('');
    await flushMeasurements();
    expect(input.isCompact()).toBe(true);
  });

  it('cancels pending work when disposed', async () => {
    const input = setup('a'.repeat(40));
    await flushMeasurements();
    expect(input.isCompact()).toBe(false);

    input.resize(1000);
    input.dispose();
    await flushMeasurements();
    expect(input.isCompact()).toBe(false);
    expect(document.querySelectorAll('[data-lexical-editor]')).toHaveLength(1);
  });

  it('expands when a short paragraph becomes a blockquote and compacts when converted back', async () => {
    const input = setup('short draft');
    await flushMeasurements();
    expect(input.isCompact()).toBe(true);

    input.setText('short draft', true);
    await flushMeasurements();
    expect(input.isCompact()).toBe(false);
    expect(input.hasMultilineContent()).toBe(true);

    input.setText('short draft');
    await flushMeasurements();
    expect(input.isCompact()).toBe(true);
  });

  it('keeps forced expansion separate from whether the content needs multiple lines', async () => {
    const input = setup('short draft');
    input.setMode('expanded');
    await flushMeasurements();
    expect(input.isCompact()).toBe(false);
    expect(input.hasMultilineContent()).toBe(false);

    input.setText('another short draft');
    await flushMeasurements();
    expect(input.isCompact()).toBe(false);

    input.setMode('auto');
    await flushMeasurements();
    expect(input.isCompact()).toBe(true);
  });

  it('never collapses a wrapping paragraph converted from a draft that mounted expanded', async () => {
    const input = setup('a'.repeat(33), true);
    await flushMeasurements();
    expect(input.isCompact()).toBe(false);

    input.setText('a'.repeat(33));
    await flushMeasurements();
    expect(input.isCompact()).toBe(false);
    expect(input.compactStates).not.toContain(true);
  });

  it('remeasures controls changed while expanded without visiting compact mode', async () => {
    const input = setup('a'.repeat(30), true);
    await flushMeasurements();
    input.setControlsWidth(120);
    await flushMeasurements();

    input.setText('a'.repeat(30));
    await flushMeasurements();
    expect(input.isCompact()).toBe(false);
    expect(input.compactStates).not.toContain(true);
  });

  it('tracks draft changes while collapsed and expands when auto mode resumes', async () => {
    const input = setup();
    input.setMode('collapsed');
    input.setText('a'.repeat(50));
    await flushMeasurements();
    expect(input.isCompact()).toBe(true);
    expect(input.hasMultilineContent()).toBe(true);

    input.setMode('auto');
    await flushMeasurements();
    expect(input.isCompact()).toBe(false);

    input.setMode('collapsed');
    input.setText('short quote', true);
    await flushMeasurements();
    expect(input.isCompact()).toBe(true);
    expect(input.hasMultilineContent()).toBe(true);

    input.setMode('auto');
    await flushMeasurements();
    expect(input.isCompact()).toBe(false);
  });

  it('reads the live compact layout without copying the composer', async () => {
    const input = setup('short');
    await flushMeasurements();
    const clone = vi.spyOn(input.container, 'cloneNode');

    input.setText('a'.repeat(20));
    await flushMeasurements();
    expect(input.isCompact()).toBe(true);
    input.setText('a'.repeat(33));
    await flushMeasurements();
    expect(input.isCompact()).toBe(false);
    input.setText('a'.repeat(20));
    await flushMeasurements();
    expect(input.isCompact()).toBe(true);
    // Edits that keep the layout read the live lines. Each switch is checked
    // against a copy, and the expanded layout copies once to learn the
    // compact line's room.
    expect(clone).toHaveBeenCalledTimes(3);
    input.setText('a'.repeat(25));
    input.setText('a'.repeat(30));
    await flushMeasurements();
    expect(clone).toHaveBeenCalledTimes(3);
  });

  it('does not measure when only the caret moves', async () => {
    const input = setup('a'.repeat(20));
    await flushMeasurements();
    const measure = vi.mocked(Range.prototype.getBoundingClientRect);
    measure.mockClear();

    input.editor.update(() => $getRoot().selectStart(), { discrete: true });
    input.editor.update(() => $getRoot().selectEnd(), { discrete: true });
    await flushMeasurements();
    expect(measure).not.toHaveBeenCalled();
    expect(input.isCompact()).toBe(true);
  });

  it('compares edits of a one-line expanded draft with the compact line it probed', async () => {
    const input = setup();
    input.setMode('expanded');
    input.setText('a'.repeat(20));
    await flushMeasurements();
    expect(input.hasMultilineContent()).toBe(false);
    const clone = vi.spyOn(input.container, 'cloneNode');

    // 10px per character: the compact line holds 32, the expanded one 40.
    for (const [length, wraps] of [
      [25, false],
      [31, false],
      [35, true],
      [39, true],
      [45, true],
      [28, false],
    ] as const) {
      input.setText('a'.repeat(length));
      await flushMeasurements();
      expect(input.hasMultilineContent()).toBe(wraps);
    }
    // Only the two edits that change the answer check it against a copy.
    expect(clone).toHaveBeenCalledTimes(2);

    input.setMode('auto');
    await flushMeasurements();
    expect(input.isCompact()).toBe(true);
  });

  it('probes again once the controls beside the text change', async () => {
    const input = setup();
    input.setMode('expanded');
    input.setText('a'.repeat(30));
    await flushMeasurements();
    expect(input.hasMultilineContent()).toBe(false);

    input.setControlsWidth(120);
    input.setText('a'.repeat(30));
    await flushMeasurements();
    expect(input.hasMultilineContent()).toBe(true);
  });

  it('does not switch on lines read while the live insets are still moving', async () => {
    const input = setup('a'.repeat(30));
    await flushMeasurements();
    expect(input.isCompact()).toBe(true);

    // Mid-transition the live line is 30px short of the compact layout's.
    input.setLiveInset(30);
    input.setText('a'.repeat(31));
    await flushMeasurements();
    expect(input.isCompact()).toBe(true);
    expect(input.compactStates).not.toContain(false);

    input.setLiveInset(0);
    input.setText('a'.repeat(33));
    await flushMeasurements();
    expect(input.isCompact()).toBe(false);
  });

  it('probes again when the paragraph is indented or outdented', async () => {
    const input = setup();
    input.setMode('expanded');
    input.setText('a'.repeat(20));
    await flushMeasurements();
    const clone = vi.spyOn(input.container, 'cloneNode');

    const setIndent = (indent: number) =>
      input.editor.update(
        () => {
          const paragraph = $getRoot().getFirstChild();
          if ($isParagraphNode(paragraph)) paragraph.setIndent(indent);
        },
        { discrete: true }
      );
    // The indent narrows the paragraph's room, so the cached room is stale.
    setIndent(1);
    await flushMeasurements();
    expect(clone).toHaveBeenCalledTimes(1);
    setIndent(0);
    await flushMeasurements();
    expect(clone).toHaveBeenCalledTimes(2);
  });
});
