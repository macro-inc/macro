import { plainRichText } from '@macro-inc/graphics';
import type { SerializedEditorState } from 'lexical';
import { expect, it } from 'vitest';
import { serializeCanvasTextState } from './text-serialization';

it('preserves unfinished mention searches as text without persisting picker state', () => {
  const state = JSON.parse(plainRichText('@Ada'));
  state.root.children[0].children[0].type = 'inline-search';
  state.root.children[0].children[0].format = 1;
  const saved = JSON.parse(serializeCanvasTextState(state));
  expect(saved.root.children[0].children[0]).toMatchObject({
    type: 'text',
    text: '@Ada',
    format: 1,
  });
  expect(state.root.children[0].children[0].type).toBe('inline-search');
});

it('retains complete mention nodes as part of the serialized string', () => {
  const state = JSON.parse(plainRichText());
  state.root.children[0].children = [
    {
      type: 'user-mention',
      version: 1,
      userId: 'user-1',
      email: 'ada@example.com',
      displayName: 'Ada',
    },
    {
      type: 'document-mention',
      version: 1,
      documentId: 'doc-1',
      documentName: 'Spec',
      blockName: 'write',
    },
  ];
  const saved = serializeCanvasTextState(state as SerializedEditorState);
  expect(typeof saved).toBe('string');
  expect(JSON.parse(saved)).toEqual(state);
});
