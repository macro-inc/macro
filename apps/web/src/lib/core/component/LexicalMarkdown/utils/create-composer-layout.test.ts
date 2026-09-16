/** @vitest-environment jsdom */

import { $createQuoteNode, QuoteNode } from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical';
import { createRoot, createSignal } from 'solid-js';
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
      const probe = this.commonAncestorContainer as HTMLElement;
      const width = Number.parseFloat(probe.style.width);
      const lines = Math.max(
        1,
        Math.ceil(((probe.textContent?.length ?? 0) * 10) / width)
      );
      return new DOMRect(0, 0, width, lines * 20);
    }),
  });
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

function setup(initialText = '') {
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
  setText(initialText);
  let containerWidth = 400;
  return createRoot((dispose) => {
    cleanups.push(dispose);
    const [mode, setMode] = createSignal<ComposerLayoutMode>('auto');
    const layout = createComposerLayout(editor, {
      container: () => container,
      mode,
    });
    vi.spyOn(container, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, 0, containerWidth, 60)
    );
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(
      () =>
        new DOMRect(0, 0, containerWidth - (layout.isCompact() ? 80 : 0), 20)
    );
    editor.setRootElement(element);
    cleanups.push(() => editor.setRootElement(null));
    return {
      ...layout,
      setText,
      setMode,
      element,
      container,
      dispose,
      resize: (width: number) => {
        containerWidth = width;
        resize.notify();
      },
    };
  });
}

async function flushMeasurements() {
  // Includes the second measurement after the layout reacts to wrapping.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('composer layout', () => {
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
    expect(input.container.children).toHaveLength(1);
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
    expect(input.container.children).toHaveLength(1);
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
});
