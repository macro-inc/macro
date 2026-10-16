import type { SerializedEditorState } from 'lexical';
import { expect, it } from 'vitest';
import {
  plainRichText,
  richTextPlainText,
  serializeCanvasTextState,
  validCanvasText,
} from './text-codec';

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
  expect(validCanvasText(saved)).toBe(true);
  expect(richTextPlainText(saved).trim()).not.toBe('');
});

it('validates the editor envelope and bounds tree depth, node count and text size', () => {
  expect(validCanvasText(plainRichText('First\nSecond', 'center'))).toBe(true);
  expect(richTextPlainText(plainRichText('First\nSecond'))).toBe(
    'First\nSecond'
  );
  expect(richTextPlainText(plainRichText(' \n ')).trim()).toBe('');
  for (const invalid of [
    '',
    '{broken',
    '{}',
    JSON.stringify({ root: { type: 'root', version: 1 } }),
    plainRichText('x'.repeat(100_001)),
    'x'.repeat(2_000_001),
  ])
    expect(validCanvasText(invalid)).toBe(false);
  let child: unknown = { type: 'text', version: 1, text: 'Deep' };
  for (let i = 0; i < 65; i++)
    child = { type: 'paragraph', version: 1, children: [child] };
  expect(
    validCanvasText(
      JSON.stringify({ root: { type: 'root', version: 1, children: [child] } })
    )
  ).toBe(false);
  expect(
    validCanvasText(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: Array.from({ length: 10_000 }, () => ({
            type: 'paragraph',
            version: 1,
            children: [],
          })),
        },
      })
    )
  ).toBe(false);
});
