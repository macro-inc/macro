/** @vitest-environment jsdom */

import { CommandCode } from '@macro-inc/collaboration/session/abi.generated';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { beforeAll, expect, test, vi } from 'vitest';
import type { NodekeyOffset } from './findAndReplacePlugin';
import { createNativeDocumentFind } from './native';

beforeAll(initializeNativeSurfaceTests);

const document = (...texts: string[]) =>
  JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      direction: null,
      format: '',
      indent: 0,
      children: texts.map((text) => ({
        type: 'paragraph',
        version: 1,
        direction: null,
        format: '',
        indent: 0,
        textFormat: 0,
        textStyle: '',
        children: [
          {
            type: 'text',
            version: 1,
            text,
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
          },
        ],
      })),
    },
  });

function setup(query: string) {
  const fixture = nativeSurface();
  fixture.port.setState(document('One apple, one pear.', 'ONE plum'));
  // The seed is not an undo step.
  fixture.port.command(CommandCode.ClearHistory);
  let listOffset: NodekeyOffset[] = [];
  const find = createNativeDocumentFind({
    getListOffset: () => listOffset,
    setListOffset: (next) => {
      listOffset = next;
    },
    refreshQuery: () => query,
  });
  find.observer.published(fixture.view);
  return { fixture, find, offsets: () => listOffset };
}

const paragraphs = (root: HTMLElement) =>
  [...root.children].map((child) => child.textContent);

test('native find reports Source-shaped match pieces keyed to rendered leaves', () => {
  const { fixture, find, offsets } = setup('one');
  try {
    find.engine.search('one');
    expect(offsets().map((piece) => [piece.pairKey, piece.offset])).toEqual([
      [1, { start: 0, end: 3, isReplace: true }],
      [2, { start: 11, end: 14, isReplace: true }],
      [3, { start: 0, end: 3, isReplace: true }],
    ]);
    for (const piece of offsets())
      expect(find.engine.getElementByKey(piece.key)?.textContent).toMatch(
        /one/i
      );
  } finally {
    fixture.close();
  }
});

test('native replace once rewrites only the current match; replace all rewrites the rest', () => {
  const { fixture, find, offsets } = setup('one');
  try {
    find.engine.search('one');
    find.engine.replaceOnce({
      replaceString: 'two',
      nodeKeyOffsetList: offsets().filter((piece) => piece.pairKey === 2),
    });
    expect(paragraphs(fixture.root)).toEqual([
      'One apple, two pear.',
      'ONE plum',
    ]);
    find.engine.search('one');
    find.engine.replaceAll({
      replaceString: 'six',
      nodeKeyOffsetList: offsets(),
    });
    expect(paragraphs(fixture.root)).toEqual([
      'six apple, two pear.',
      'six plum',
    ]);
  } finally {
    fixture.close();
  }
});

test('one undo reverts a whole Replace All across blocks', () => {
  const { fixture, find, offsets } = setup('one');
  try {
    find.engine.search('one');
    find.engine.replaceAll({
      replaceString: 'six',
      nodeKeyOffsetList: offsets(),
    });
    expect(paragraphs(fixture.root)).toEqual([
      'six apple, six pear.',
      'six plum',
    ]);
    fixture.port.command(CommandCode.Undo);
    expect(paragraphs(fixture.root)).toEqual([
      'One apple, one pear.',
      'ONE plum',
    ]);
  } finally {
    fixture.close();
  }
});

test('a replace after a key-generation change sends nothing for the stale pieces', () => {
  // The bar is closed (no refresh query): the spy generation cannot be queried.
  const { fixture, find, offsets } = setup('');
  try {
    find.engine.search('one');
    const stale = offsets();
    const generation = fixture.view.mirror.keyGeneration;
    if (generation === null) throw new Error('Missing key generation');
    // Synthetic stand-in for a mirror re-initialize, the only path that
    // replaces the key generation (a reset or resync rebinds the view).
    vi.spyOn(fixture.view.mirror, 'keyGeneration', 'get').mockReturnValue(
      generation + 1
    );
    const input = vi.spyOn(fixture.view.port, 'input');
    find.engine.replaceAll({ replaceString: 'six', nodeKeyOffsetList: stale });
    find.engine.replaceOnce({
      replaceString: 'six',
      nodeKeyOffsetList: stale.filter((piece) => piece.pairKey === 1),
    });
    expect(input).not.toHaveBeenCalled();
    // Stale pieces have no rendered element to highlight or scroll to.
    expect(find.engine.getElementByKey(stale[0].key)).toBeNull();
    expect(paragraphs(fixture.root)).toEqual([
      'One apple, one pear.',
      'ONE plum',
    ]);
  } finally {
    vi.restoreAllMocks();
    fixture.close();
  }
});

test('a published content change refreshes the open query', async () => {
  const { fixture, find, offsets } = setup('pear');
  try {
    find.engine.search('pear');
    expect(offsets()).toHaveLength(1);
    fixture.port.setState(document('pear', 'pear pear'));
    find.observer.published(fixture.view);
    await Promise.resolve();
    expect(offsets().map((piece) => piece.pairKey)).toEqual([1, 2, 3]);
  } finally {
    fixture.close();
  }
});
