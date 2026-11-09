import { expect, test } from 'vitest';
import {
  $createParagraphNode,
  $createTextNode,
  $getEditor,
  $getNodeByKey,
  $getRoot,
  createEditor,
} from '../index';

test('the public editor batches two updates and retains historical JS node identities', async () => {
  const editor = createEditor({ namespace: 'public editor' });
  try {
    const initial = editor.getEditorState();
    expect(initial.isEmpty()).toBe(true);
    let calls = 0;
    const order: string[] = [];
    editor.registerUpdateListener(({ editorState, prevEditorState }) => {
      calls++;
      expect(prevEditorState).toBe(initial);
      expect(editorState).toBe(editor.getEditorState());
      expect(editorState.read(() => $getRoot().getTextContent())).toBe(
        'first\n\nsecond'
      );
      order.push('listener');
    });
    editor.update(
      () => {
        expect($getEditor()).toBe(editor);
        const text = $createTextNode('first');
        $getRoot().append($createParagraphNode().append(text));
        expect($getNodeByKey(text.getKey())).toBe(text);
      },
      { onUpdate: () => order.push('first') }
    );
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode('second'))
        );
      },
      { onUpdate: () => order.push('second') }
    );
    expect(calls).toBe(0);
    expect(editor.getEditorState()).toBe(initial);
    await Promise.resolve();
    expect(calls).toBe(1);
    expect(order).toEqual(['listener', 'first', 'second']);
    expect(initial.isEmpty()).toBe(true);
    expect(initial.toJSON()).toMatchObject({ root: { children: [] } });
    const state = editor.getEditorState();
    const root = state.read($getRoot);
    expect(state.read($getRoot)).toBe(root);
    expect(state.toJSON()).toMatchObject({
      root: {
        type: 'root',
        children: [{ type: 'paragraph' }, { type: 'paragraph' }],
      },
    });
    expect(() => state.read(() => $createTextNode('readonly'))).toThrow(
      /read-only/
    );
  } finally {
    editor.dispose();
  }
});

test('nested editors restore the active facade after success and opaque failure', () => {
  const first = createEditor({ namespace: 'outer public editor' });
  const second = createEditor({ namespace: 'inner public editor' });
  const opaque = {};
  try {
    first.update(
      () => {
        expect($getEditor()).toBe(first);
        second.update(
          () => {
            expect($getEditor()).toBe(second);
            $getRoot().append(
              $createParagraphNode().append($createTextNode('inner'))
            );
          },
          { discrete: true }
        );
        expect($getEditor()).toBe(first);
        try {
          second.getEditorState().read(() => {
            expect(() => $getEditor()).toThrow(
              'Unable to find an active editor'
            );
            expect($getRoot().getTextContent()).toBe('inner');
            throw opaque;
          });
          throw new Error('read should throw');
        } catch (error) {
          expect(error).toBe(opaque);
        }
        expect($getEditor()).toBe(first);
        $getRoot().append(
          $createParagraphNode().append($createTextNode('outer'))
        );
      },
      { discrete: true }
    );
    expect(first.read(() => $getRoot().getTextContent())).toBe('outer');
    expect(second.read(() => $getRoot().getTextContent())).toBe('inner');
    expect(() => $getRoot()).toThrow('Unable to find an active editor');
  } finally {
    second.dispose();
    first.dispose();
  }
});

test('native constructors retain their actual instances and upstream enumerable field order', () => {
  const editor = createEditor({ namespace: 'native constructor fields' });
  try {
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const text = $createTextNode('😀e\u0301');
        expect(Object.keys(paragraph)).toEqual([
          '__type',
          '__key',
          '__parent',
          '__prev',
          '__next',
          '__first',
          '__last',
          '__size',
          '__format',
          '__style',
          '__indent',
          '__dir',
          '__textFormat',
          '__textStyle',
        ]);
        expect(Object.keys(text)).toEqual([
          '__type',
          '__key',
          '__parent',
          '__prev',
          '__next',
          '__text',
          '__format',
          '__style',
          '__mode',
          '__detail',
        ]);
        expect(Object.getOwnPropertyDescriptor(text, '__text')?.get).toBeTypeOf(
          'function'
        );
        expect(
          Object.getOwnPropertyDescriptor(text, '__state')?.enumerable
        ).toBe(false);
        expect(Reflect.get(text, '__text')).toBe('😀e\u0301');
        expect(text.getTextContentSize()).toBe(4);
        paragraph.append(text);
        $getRoot().append(paragraph);
        expect($getNodeByKey(paragraph.getKey())).toBe(paragraph);
        expect(paragraph.getChildren()[0]).toBe(text);
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});

test('node graph methods use the active editor while raw fields and key comparisons stay captured', () => {
  const first = createEditor({ namespace: 'captured public editor' });
  const second = createEditor({ namespace: 'active public editor' });
  try {
    first.update(
      () => {
        const root = $getRoot();
        const text = $createTextNode('outer');
        root.append($createParagraphNode().append(text));
        second.update(
          () => {
            $getRoot().append(
              $createParagraphNode().append($createTextNode('inner'))
            );
            expect(root.getLatest()).toBe($getRoot());
            expect(root.getTextContent()).toBe('inner');
            expect(() => text.setTextContent('wrong editor')).toThrow(
              'Lexical node does not exist in active editor state'
            );
            expect(Reflect.get(text, '__text')).toBe('outer');
          },
          { discrete: true }
        );
        expect(text.getTextContent()).toBe('outer');
      },
      { discrete: true }
    );
    const root = first.read($getRoot);
    expect(root.is(root)).toBe(true);
    expect(root.is(null)).toBe(false);
    expect(root.is(undefined)).toBe(false);
    expect(() => root.getTextContent()).toThrow(
      'Unable to find an active editor state'
    );
  } finally {
    second.dispose();
    first.dispose();
  }
});
