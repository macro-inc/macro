import { expect, test } from 'vitest';
import { createEditor, TextNode } from '../index';

test('default editor configuration constructs a readable empty state', () => {
  const editor = createEditor();
  try {
    expect(editor.getEditorState().isEmpty()).toBe(true);
  } finally {
    editor.dispose();
  }
});

test('JS error callbacks stay outside the native serialized configuration', () => {
  const failure = new Error('configuration callback');
  const observed: unknown[] = [];
  const editor = createEditor({ onError: (error) => observed.push(error) });
  try {
    editor.update(() => {
      throw failure;
    });
    expect(observed).toEqual([failure]);
    expect(editor.getEditorState().isEmpty()).toBe(true);
  } finally {
    editor.dispose();
  }
});

test('development construction rejects unsupported JS class registrations', () => {
  class CustomText extends TextNode {
    static getType(): string {
      return 'configured-text';
    }
  }
  expect(() => createEditor({ nodes: [CustomText] })).toThrow(
    'JS node class registration requires the production compatibility host'
  );
});
