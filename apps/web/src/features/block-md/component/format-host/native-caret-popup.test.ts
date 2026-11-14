/** @vitest-environment jsdom */

import { createNativeImageContext } from '@core/component/LexicalMarkdown/decorator-host/native-image-host';
import { createNativeImageDecoratorViews } from '@core/component/LexicalMarkdown/decorator-host/native-image-views';
import { createNativeMediaUploadEvents } from '@core/component/LexicalMarkdown/plugins/media/native-upload-events';
import { theme } from '@core/component/LexicalMarkdown/theme';
import { ImageNode } from '@macro-inc/lexical-core';
import {
  clearDecorators,
  setDecorator,
} from '@macro-inc/lexical-core/decoratorRegistry';
import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type { ViewSelection } from '@macro-inc/lexical-wasm-view/view/types';
import { createRoot } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';
import { createNativeDocumentFormattingHost } from './native';
import { createNativeDocumentLinkMenuHost } from './native-link-host';
import { mount } from './native-test-fixture';

// C-TOUCH-CARET-MODE-01 against Source popupPlugin (:190-195): an EMPTY-TEXT
// range selection shows the popup only through $allowEmptySelection, which
// MarkdownPopup supplies on touch devices (:183-191). The native controller
// consults the same predicate, with the selection of the commit it is
// deciding on, on touch only; desktop never shows it.

const device = vi.hoisted(() => ({ touch: true }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));

const owned: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  const failures: unknown[] = [];
  for (const release of owned.splice(0).reverse())
    try {
      await release();
    } catch (error) {
      failures.push(error);
    }
  device.touch = true;
  clearDecorators();
  document.getSelection()?.removeAllRanges();
  if (failures.length > 0) throw failures[0];
});

const text = (value: string) => ({ type: 'text', version: 1, text: value });

const image = (id: string) => ({
  type: 'image',
  version: 1,
  srcType: 'url',
  id,
  url: `https://example.com/${id}.png`,
  alt: id,
  width: 40,
  height: 30,
  scale: 1,
});

/** One paragraph: "Before ", a comment mark around "marked" and an inline
 *  image, " after", then an inline image outside any comment. */
const seed = JSON.stringify({
  root: {
    type: 'root',
    version: 1,
    children: [
      {
        type: 'paragraph',
        version: 1,
        children: [
          text('Before '),
          {
            type: 'comment-mark',
            version: 1,
            ids: ['mark-a'],
            isDraft: false,
            children: [text('marked'), image('image-inside')],
          },
          text(' after'),
          image('image-outside'),
        ],
      },
    ],
  },
});

function setup(allow: (selection: ViewSelection) => boolean) {
  const seen: ViewSelection[] = [];
  const shown: boolean[] = [];
  let controller:
    | ReturnType<typeof createNativeDocumentFormattingHost>
    | undefined;
  const runtime = mount([
    {
      published(view) {
        controller?.observer.published(view);
      },
      unavailable(reason) {
        controller?.observer.unavailable(reason);
      },
      retired() {
        controller?.observer.retired();
      },
    },
  ]);
  owned.push(async () => {
    if (runtime.view.isMounted) await runtime.close();
    runtime.root.remove();
  });
  // The real native image decorator view, as RustMarkdownEditor registers it.
  setDecorator(ImageNode, () => document.createElement('span'));
  const uploads = createNativeMediaUploadEvents();
  const images = createNativeImageContext(theme, () => true, uploads);
  owned.push(() => {
    images.dispose();
    uploads.dispose();
  });
  registerMacroDecoratorViews(
    runtime.view.registry,
    createNativeImageDecoratorViews(images)
  );
  createRoot((dispose) => {
    owned.push(dispose);
    const links = createNativeDocumentLinkMenuHost(runtime.view, {
      canEdit: () => true,
      alive: () => true,
    });
    controller = createNativeDocumentFormattingHost(runtime.view, {
      canEdit: () => true,
      alive: () => true,
      links,
      allowEmptySelection: (selection: ViewSelection) => {
        seen.push(structuredClone(selection));
        return allow(selection);
      },
    });
    owned.push(() => controller?.dispose());
    controller.bodyPopup.registerPopup({
      visible: (value) => {
        shown.push(value);
        return true;
      },
      selection: () => {},
    });
  });
  runtime.port.setState(seed);
  runtime.root.tabIndex = 0;
  runtime.root.focus();
  return { runtime, seen, shown };
}

type Runtime = ReturnType<typeof setup>['runtime'];

/** Set the MODEL selection; every row first proves the model took it. */
function place(runtime: Runtime, selection: ViewSelection) {
  runtime.port.selectionFromView(selection);
  expect(runtime.view.selection().selection).toEqual(selection);
}
function textKey(runtime: Runtime, value: string) {
  const node = [...runtime.view.mirror.values()].find(
    (candidate) => candidate.kind === 'text' && candidate.text === value
  );
  if (!node) throw new Error(`Missing text node ${value}`);
  return node.key;
}
function caret(runtime: Runtime, value: string, offset: number): ViewSelection {
  const key = textKey(runtime, value);
  return {
    kind: 'range',
    anchor: { key, offset, type: 'text' },
    focus: { key, offset, type: 'text' },
  };
}
/** A range spanning only one inline image (element points around it):
 *  `inside` the comment mark, or `outside` any comment. */
function imageOnly(runtime: Runtime, placement: 'inside' | 'outside') {
  const images = [...runtime.view.mirror.values()].filter(
    (candidate) => candidate.type === 'image'
  );
  const found = images[placement === 'inside' ? 0 : 1];
  if (images.length !== 2 || !found || found.parent === null)
    throw new Error('Expected two inline images');
  const parent = runtime.view.mirror.node(found.parent);
  const index = parent?.children.indexOf(found.key) ?? -1;
  if (!parent || index < 0) throw new Error('Missing image parent');
  expect(parent.type).toBe(
    placement === 'inside' ? 'comment-mark' : 'paragraph'
  );
  const selection: ViewSelection = {
    kind: 'range',
    anchor: { key: parent.key, offset: index, type: 'element' },
    focus: { key: parent.key, offset: index + 1, type: 'element' },
  };
  return selection;
}

test('on touch, a caret the predicate admits shows the popup', () => {
  const { runtime, shown } = setup(() => true);
  place(runtime, caret(runtime, 'marked', 2));
  expect(shown.at(-1)).toBe(true);
});

test('on touch, a caret the predicate refuses shows nothing', () => {
  const { runtime, shown } = setup(() => false);
  place(runtime, caret(runtime, 'Before ', 2));
  expect(shown.includes(true)).toBe(false);
});

test('on desktop, an empty-text selection never shows the popup', () => {
  device.touch = false;
  const { runtime, shown, seen } = setup(() => true);
  place(runtime, caret(runtime, 'marked', 2));
  expect(shown.includes(true)).toBe(false);
  expect(seen).toEqual([]);
});

test('the predicate decides on the selection of the same commit', () => {
  // A predicate that admits only a caret in "marked": moving from inside to
  // outside in one commit must hide the popup, deciding on the new caret.
  let markedKey = -1;
  const { runtime, seen, shown } = setup(
    (selection) =>
      selection.kind === 'range' && selection.anchor.key === markedKey
  );
  markedKey = textKey(runtime, 'marked');
  place(runtime, caret(runtime, 'marked', 2));
  expect(seen.at(-1)).toEqual(caret(runtime, 'marked', 2));
  expect(shown.at(-1)).toBe(true);
  place(runtime, caret(runtime, 'Before ', 2));
  expect(seen.at(-1)).toEqual(caret(runtime, 'Before ', 2));
  expect(shown.at(-1)).toBe(false);
});

test('on touch, a zero-text range over only an inline image goes through the predicate', () => {
  for (const placement of ['inside', 'outside'] as const) {
    const admitted = setup(() => true);
    place(admitted.runtime, imageOnly(admitted.runtime, placement));
    expect({ placement, shown: admitted.shown.at(-1) }).toEqual({
      placement,
      shown: true,
    });
    const refused = setup(() => false);
    place(refused.runtime, imageOnly(refused.runtime, placement));
    expect({ placement, shown: refused.shown.includes(true) }).toEqual({
      placement,
      shown: false,
    });
  }
});

test("native plain text of an image-only range is '', as Source's image text", () => {
  // Source: ImageNode extends MediaNode, neither overrides getTextContent,
  // so the DecoratorNode default ''. The native bytes are recorded literally.
  const { runtime } = setup(() => false);
  const plain = (['inside', 'outside'] as const).map((placement) => {
    place(runtime, imageOnly(runtime, placement));
    return { placement, plain: runtime.view.clipboard.formats(0).plain };
  });
  expect(plain).toEqual([
    { placement: 'inside', plain: '' },
    { placement: 'outside', plain: '' },
  ]);
});
