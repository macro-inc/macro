import {
  $getChildCaret as childOriginal,
  $comparePointCaretNext as compareOriginal,
  createEditor as editorOriginal,
  $getChildCaretAtIndex as indexOriginal,
  $normalizeCaret as normalizeOriginal,
  $createParagraphNode as paragraphOriginal,
  $getTextPointCaret as pointOriginal,
  $getCaretRange as rangeOriginal,
  $getRoot as rootOriginal,
  $getSiblingCaret as siblingOriginal,
  $getTextPointCaretSlice as sliceOriginal,
  $createTextNode as textOriginal,
} from 'lexical';
import { expect, test } from 'vitest';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from '../index';
import { $comparePointCaretNext } from './ancestry';
import { $getCaretInDirection, $getCaretRangeInDirection } from './direction';
import {
  $getChildCaret,
  $getSiblingCaret,
  $getTextPointCaret,
} from './node-carets';
import { $getCaretRange, $getTextPointCaretSlice } from './ranges';
import {
  $caretFromPoint,
  $getAdjacentNodes,
  $getChildCaretAtIndex,
  $normalizeCaret,
} from './utils';

test('actual caret traversal, slices and NaN ordering match frozen Original on real graphs', () => {
  const original = editorOriginal({
    onError(error) {
      throw error;
    },
  });
  let expected: unknown;
  original.update(
    () => {
      const paragraph = paragraphOriginal();
      const first = textOriginal('alpha');
      const second = textOriginal('beta');
      paragraph.append(first, second);
      rootOriginal().append(paragraph);
      const anchor = pointOriginal(first, 'next', 1);
      const focus = pointOriginal(second, 'next', 2);
      const range = rangeOriginal(anchor, focus);
      expected = {
        children: [...childOriginal(paragraph, 'next')].map((caret) =>
          caret.origin.getTextContent()
        ),
        slices: range
          .getTextSlices()
          .map((slice) => slice?.getTextContent() ?? null),
        order: compareOriginal(anchor, focus),
        nan: Number.isNaN(
          compareOriginal(
            pointOriginal(first, 'next', NaN),
            pointOriginal(first, 'next', NaN)
          )
        ),
        flipped: anchor.getFlipped().direction,
        adjacent: [...indexOriginal(paragraph, 1, 'next')].map((caret) =>
          caret.origin.getTextContent()
        ),
        normalized: normalizeOriginal(childOriginal(paragraph, 'next')).type,
      };
    },
    { discrete: true }
  );
  const actual = createEditor({
    onError(error) {
      throw error;
    },
  });
  try {
    actual.update(() => {
      const paragraph = $createParagraphNode();
      const first = $createTextNode('alpha');
      const second = $createTextNode('beta');
      paragraph.append(first, second);
      $getRoot().append(paragraph);
      const anchor = $getTextPointCaret(first, 'next', 1);
      const focus = $getTextPointCaret(second, 'next', 2);
      const range = $getCaretRange(anchor, focus);
      expect({
        children: [...$getChildCaret(paragraph, 'next')].map((caret) =>
          caret.origin.getTextContent()
        ),
        slices: range
          .getTextSlices()
          .map((slice) => slice?.getTextContent() ?? null),
        order: $comparePointCaretNext(anchor, focus),
        nan: Number.isNaN(
          $comparePointCaretNext(
            $getTextPointCaret(first, 'next', NaN),
            $getTextPointCaret(first, 'next', NaN)
          )
        ),
        flipped: anchor.getFlipped().direction,
        adjacent: $getAdjacentNodes(
          $getChildCaretAtIndex(paragraph, 1, 'next')
        ).map((node) => node.getTextContent()),
        normalized: $normalizeCaret($getChildCaret(paragraph, 'next')).type,
      }).toEqual(expected);
      expect(
        $caretFromPoint(
          { key: first.getKey(), offset: 1, type: 'text' },
          'next'
        ).isSamePointCaret(anchor)
      ).toBe(true);
      expect($getCaretInDirection(anchor, 'next')).toBe(anchor);
      expect($getCaretRangeInDirection(range, 'next')).toBe(range);
      const reversed = $getCaretRangeInDirection(range, 'previous');
      expect(reversed.anchor.origin).toBe(focus.origin);
      expect(reversed.focus.origin).toBe(anchor.origin);
      expect(reversed.anchor.direction).toBe('previous');
      expect($getSiblingCaret(null, 'next')).toBe(null);
      expect($getTextPointCaret(null, 'previous', 0)).toBe(null);
      expect($getTextPointCaretSlice(anchor, 3).getTextContent()).toBe('lph');
    });
  } finally {
    actual.dispose();
  }
});

test('actual slice removal and caret splicing preserve the same live-node order as Original', () => {
  const original = editorOriginal({
    onError(error) {
      throw error;
    },
  });
  let expected: unknown;
  original.update(
    () => {
      const paragraph = paragraphOriginal();
      const first = textOriginal('alpha');
      const second = textOriginal('beta');
      const last = textOriginal('gamma');
      paragraph.append(first, second, last);
      rootOriginal().append(paragraph);
      const cut = sliceOriginal(
        pointOriginal(first, 'next', 1),
        2
      ).removeTextSlice();
      siblingOriginal(first, 'next').splice(1, [last]);
      expected = {
        offset: cut.offset,
        text: cut.origin.getTextContent(),
        children: paragraph.getChildren().map((node) => node.getTextContent()),
        removed: second.isAttached(),
      };
    },
    { discrete: true }
  );
  const actual = createEditor({
    onError(error) {
      throw error;
    },
  });
  try {
    actual.update(() => {
      const paragraph = $createParagraphNode();
      const first = $createTextNode('alpha');
      const second = $createTextNode('beta');
      const last = $createTextNode('gamma');
      paragraph.append(first, second, last);
      $getRoot().append(paragraph);
      const cut = $getTextPointCaretSlice(
        $getTextPointCaret(first, 'next', 1),
        2
      ).removeTextSlice();
      $getSiblingCaret(first, 'next').splice(1, [last]);
      expect({
        offset: cut.offset,
        text: cut.origin.getTextContent(),
        children: paragraph.getChildren().map((node) => node.getTextContent()),
        removed: second.isAttached(),
      }).toEqual(expected);
    });
  } finally {
    actual.dispose();
  }
});
