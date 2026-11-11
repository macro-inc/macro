import * as lexical from 'lexical';
import { describe, expect, test } from 'vitest';
import { getNodesFromReadCaretRange, setSelectionValue } from '../helpers';
import { isPointBefore } from '../point';
import { getSelectionTextContent } from '../range';

function readSelection(selection: lexical.RangeSelection) {
  const range = lexical.$getCaretRangeInDirection(
    lexical.$caretRangeFromSelection(selection),
    'next'
  );
  const nodes = getNodesFromReadCaretRange<
    lexical.LexicalNode,
    lexical.PointCaret
  >(range, {
    $isElementNode: lexical.$isElementNode,
    $childOrigin: (caret) =>
      caret !== null && lexical.$isChildCaret(caret) ? caret.origin : null,
    $isSiblingCaret: lexical.$isSiblingCaret,
    $getChildCaret: (origin) => {
      if (!lexical.$isElementNode(origin))
        throw new Error('Expected element origin');
      return lexical.$getChildCaret(origin, 'previous');
    },
    $getAdjacentChildCaret: (caret) => {
      if (!lexical.$isChildCaret(caret))
        throw new Error('Expected child caret');
      return lexical.$getAdjacentChildCaret(caret);
    },
    $normalizeCaret: lexical.$normalizeCaret,
    $isTextPointCaret: lexical.$isTextPointCaret,
    $isEmpty: (node) => {
      if (!lexical.$isElementNode(node)) throw new Error('Expected element');
      return node.isEmpty();
    },
    $isSameNode: (node, other) => node.is(other),
  });
  const before = isPointBefore<lexical.PointCaret<'next'>>(
    selection.anchor,
    selection.focus,
    () => lexical
  );
  const text =
    nodes.length === 0
      ? ''
      : getSelectionTextContent<
          lexical.LexicalNode,
          lexical.ElementNode,
          lexical.TextNode
        >(
          nodes,
          selection.anchor,
          selection.focus,
          before,
          lexical.$getCharacterOffsets(selection),
          selection.isCollapsed(),
          {
            isElementNode: lexical.$isElementNode,
            isTextNode: lexical.$isTextNode,
            isDecoratorNode: lexical.$isDecoratorNode,
            isLineBreakNode: lexical.$isLineBreakNode,
          }
        );
  const backward = isPointBefore<lexical.PointCaret<'next'>>(
    selection.focus,
    selection.anchor,
    () => lexical
  );
  return { nodes, text, before, backward };
}

describe('shared selection algorithms over the real upstream model', () => {
  test('matches all point pairs across empty blocks, text boundaries and line breaks without native calls', () => {
    const editor = lexical.createEditor({
      onError: (error) => {
        throw error;
      },
    });
    let checks = 0;
    editor.update(
      () => {
        const first = lexical.$createParagraphNode();
        const left = lexical.$createTextNode('😀alpha');
        const right = lexical.$createTextNode('omega').setFormat('bold');
        const line = lexical.$createLineBreakNode();
        first.append(left, line, right);
        const empty = lexical.$createParagraphNode();
        const last = lexical.$createParagraphNode();
        const tail = lexical.$createTextNode('尾');
        last.append(tail);
        lexical.$getRoot().append(first, empty, last);
        const points: [lexical.NodeKey, number, 'text' | 'element'][] = [
          ['root', 0, 'element'],
          ['root', 1, 'element'],
          ['root', 3, 'element'],
          [first.getKey(), 0, 'element'],
          [first.getKey(), 1, 'element'],
          [first.getKey(), 3, 'element'],
          [empty.getKey(), 0, 'element'],
          [left.getKey(), 0, 'text'],
          [left.getKey(), 2, 'text'],
          [left.getKey(), 7, 'text'],
          [right.getKey(), 0, 'text'],
          [right.getKey(), 5, 'text'],
          [tail.getKey(), 1, 'text'],
        ];
        for (const anchor of points) {
          for (const focus of points) {
            const value = lexical.$createRangeSelection();
            value.anchor.set(...anchor);
            value.focus.set(...focus);
            const actual = readSelection(value);
            const expected = lexical.$createRangeSelection();
            expected.anchor.set(...anchor);
            expected.focus.set(...focus);
            expect(actual.backward).toBe(expected.isBackward());
            expect(actual.nodes.map((node) => node.getKey())).toEqual(
              expected.getNodes().map((node) => node.getKey())
            );
            expect(actual.text).toBe(expected.getTextContent());
            expect(actual.before).toBe(
              expected.anchor.isBefore(expected.focus)
            );
            checks++;
          }
        }
      },
      { discrete: true }
    );
    expect(checks).toBe(169);
  });

  test('reads frozen detached values in a read scope without filling their caches', () => {
    const editor = lexical.createEditor({
      onError: (error) => {
        throw error;
      },
    });
    let key = '';
    editor.update(
      () => {
        const text = lexical.$createTextNode('before');
        key = text.getKey();
        lexical.$getRoot().append(lexical.$createParagraphNode().append(text));
      },
      { discrete: true }
    );
    const selection = lexical.$createRangeSelection().clone();
    selection.anchor.key = key;
    selection.anchor.offset = 1;
    selection.anchor.type = 'text';
    selection.focus.key = key;
    selection.focus.offset = 4;
    selection.focus.type = 'text';
    Object.freeze(selection.anchor);
    Object.freeze(selection.focus);
    Object.freeze(selection);
    editor.getEditorState().read(() => {
      expect(readSelection(selection).text).toBe('efo');
      expect(readSelection(selection).before).toBe(true);
      expect(
        readSelection(selection).nodes.map((node) => node.getKey())
      ).toEqual([key]);
      expect(selection._cachedNodes).toBeNull();
      expect(selection._cachedIsBackward).toBeNull();
    });
    editor.update(
      () => {
        const node = lexical.$getNodeByKey(key);
        if (lexical.$isTextNode(node)) node.setTextContent('after!');
      },
      { discrete: true }
    );
    editor.getEditorState().read(() => {
      expect(readSelection(selection).text).toBe('fte');
    });
  });
  test('buffers active selection changes on the actual source state without allocating native handles', () => {
    const editor = lexical.createEditor({
      onError: (error) => {
        throw error;
      },
    });
    const intents: [lexical.BaseSelection | null, boolean][] = [];
    const target = {
      isReadOnly: lexical.isCurrentlyReadOnlyMode,
      validate(selection: lexical.BaseSelection) {
        if (
          !lexical.$isRangeSelection(selection) &&
          !lexical.$isNodeSelection(selection)
        )
          throw new Error('Unsupported source selection');
      },
      activate: lexical.$setSelection,
      buffer(selection: lexical.BaseSelection | null, activate: boolean) {
        intents.push([selection, activate]);
      },
    };
    editor.update(
      () => {
        const selection = lexical.$createRangeSelection();
        setSelectionValue(selection, target);
        expect(lexical.$getSelection()).toBe(selection);
        expect(selection.dirty).toBe(true);
        expect(intents).toEqual([[selection, true]]);
        setSelectionValue(null, target);
        expect(lexical.$getSelection()).toBeNull();
        expect(intents).toEqual([
          [selection, true],
          [null, true],
        ]);
      },
      { discrete: true }
    );
    editor.getEditorState().read(() => {
      expect(() => setSelectionValue(null, target)).toThrow(
        'Cannot use method in read-only mode.'
      );
      expect(intents).toHaveLength(2);
    });
  });
});
