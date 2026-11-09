import { $createTableSelection, $isTableSelection } from '@lexical/table';
import * as lexical from 'lexical';
import { describe, expect, test } from 'vitest';
import { $setSelection } from '../helpers';
import { $createPoint } from '../point';
import { RangeSelection } from '../range';
import { type SelectionRuntime, withSelectionRuntime } from '../runtime';

function unexpectedCrossing(): never {
  throw new Error('Selection read crossed the native boundary');
}

function sourceRuntime(editor: lexical.LexicalEditor): SelectionRuntime {
  return {
    createTableSelection: $createTableSelection,
    isTableSelection: $isTableSelection,
    caret: lexical,
    nodes: lexical,
    getActiveState: () => editor._pendingEditorState ?? editor._editorState,
    getActiveStateVersion: unexpectedCrossing,
    isReadOnly: lexical.isCurrentlyReadOnlyMode,
    getNodeByKey: lexical.$getNodeByKey,
    nativeKey: unexpectedCrossing,
    publicKey: unexpectedCrossing,
    nodeReference: unexpectedCrossing,
    resolveNode: unexpectedCrossing,
    bufferSelection: unexpectedCrossing,
    invokeSelection: unexpectedCrossing,
    selectionRef: unexpectedCrossing,
    bindSelection: unexpectedCrossing,
    getPreviousSelection: lexical.$getPreviousSelection,
    getCompositionKey: unexpectedCrossing,
    setCompositionKey: unexpectedCrossing,
    isTextNode: lexical.$isTextNode,
    isElementNode: lexical.$isElementNode,
    isDecoratorNode: lexical.$isDecoratorNode,
    isLineBreakNode: lexical.$isLineBreakNode,
    applyDOMRange: unexpectedCrossing,
    modifyDOMSelection: unexpectedCrossing,
  };
}

describe('JS selection reads over the real upstream model', () => {
  test('matches all point pairs across empty blocks, text boundaries and line breaks without native calls', () => {
    const editor = lexical.createEditor({
      onError: (error) => {
        throw error;
      },
    });
    const runtime = sourceRuntime(editor);
    let checks = 0;
    editor.update(
      () =>
        withSelectionRuntime(runtime, () => {
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
              const actual = new RangeSelection(
                $createPoint(...anchor),
                $createPoint(...focus),
                0,
                ''
              );
              const expected = lexical.$createRangeSelection();
              expected.anchor.set(...anchor);
              expected.focus.set(...focus);
              expect(actual.isBackward()).toBe(expected.isBackward());
              expect(actual.getNodes().map((node) => node.getKey())).toEqual(
                expected.getNodes().map((node) => node.getKey())
              );
              expect(actual.getTextContent()).toBe(expected.getTextContent());
              expect(actual.anchor.isBefore(actual.focus)).toBe(
                expected.anchor.isBefore(expected.focus)
              );
              checks++;
            }
          }
        }),
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
    const runtime = sourceRuntime(editor);
    let key = '';
    editor.update(
      () => {
        const text = lexical.$createTextNode('before');
        key = text.getKey();
        lexical.$getRoot().append(lexical.$createParagraphNode().append(text));
      },
      { discrete: true }
    );
    const selection = new RangeSelection(
      $createPoint(key, 1, 'text'),
      $createPoint(key, 4, 'text'),
      0,
      ''
    );
    Object.freeze(selection.anchor);
    Object.freeze(selection.focus);
    Object.freeze(selection);
    editor.getEditorState().read(() =>
      withSelectionRuntime(runtime, () => {
        expect(selection.getTextContent()).toBe('efo');
        expect(selection.isBackward()).toBe(false);
        expect(selection.getNodes().map((node) => node.getKey())).toEqual([
          key,
        ]);
        expect(selection._cachedNodes).toBeNull();
        expect(selection._cachedIsBackward).toBeNull();
      })
    );
    editor.update(
      () => {
        const node = lexical.$getNodeByKey(key);
        if (lexical.$isTextNode(node)) node.setTextContent('after!');
      },
      { discrete: true }
    );
    editor.getEditorState().read(() =>
      withSelectionRuntime(runtime, () => {
        expect(selection.getTextContent()).toBe('fte');
      })
    );
  });
  test('buffers active selection changes on the actual source state without allocating native handles', () => {
    const editor = lexical.createEditor({
      onError: (error) => {
        throw error;
      },
    });
    const intents: [lexical.BaseSelection | null, boolean][] = [];
    const runtime: SelectionRuntime = {
      ...sourceRuntime(editor),
      bufferSelection: (selection, activate) => {
        intents.push([selection, activate]);
      },
    };
    editor.update(
      () =>
        withSelectionRuntime(runtime, () => {
          const selection = new RangeSelection(
            $createPoint('root', 0, 'element'),
            $createPoint('root', 0, 'element'),
            0,
            ''
          );
          $setSelection(selection);
          expect(lexical.$getSelection()).toBe(selection);
          expect(selection.dirty).toBe(true);
          expect(intents).toEqual([[selection, true]]);
          $setSelection(null);
          expect(lexical.$getSelection()).toBeNull();
          expect(intents).toEqual([
            [selection, true],
            [null, true],
          ]);
        }),
      { discrete: true }
    );
    editor.getEditorState().read(() =>
      withSelectionRuntime(runtime, () => {
        expect(() => $setSelection(null)).toThrow(
          'Cannot use method in read-only mode.'
        );
        expect(intents).toHaveLength(2);
      })
    );
  });
});
