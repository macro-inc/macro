import { describe, expect, test } from 'vitest';
import { assertReopened, documentFacts, installSteps } from './contract';

function completeState() {
  const types = [
    'heading',
    'task-list',
    'task-list',
    'custom-code',
    'table',
    'quote',
    'link',
    'user-mention',
    'equation',
    'image',
    'comment-mark',
  ];
  return {
    root: {
      type: 'root',
      $: { id: 'root' },
      children: types.map((type, index) => ({
        type,
        $: { id: `node-${index}` },
        ...(index === 2 ? { listType: 'check' } : {}),
        children: [],
      })),
    },
  };
}
describe('install contract fail-closed controls', () => {
  test('requires six steps including fresh common-block reopen', () => {
    expect(installSteps).toHaveLength(6);
    expect(installSteps[5]).toBe('all-common-blocks-persist-reopen');
  });
  test('accepts identical complete JSON, durable IDs and DOM', () => {
    const json = completeState();
    const value = { json, dom: { tag: 'DIV', children: ['text'] } };
    expect(() => assertReopened(value, structuredClone(value))).not.toThrow();
  });
  test('rejects a missing code block even when counts stay unchanged', () => {
    const json = completeState();
    json.root.children[3].type = 'paragraph';
    expect(() => documentFacts(json)).toThrow('code');
  });
  test('rejects duplicate durable IDs', () => {
    const json = completeState();
    json.root.children[1].$.id = json.root.children[0].$.id;
    expect(() => documentFacts(json)).toThrow('Duplicate');
  });
  test('rejects changed JSON with the same text and node count', () => {
    const before = completeState();
    const after = structuredClone(before);
    after.root.children[0].$.id = 'replacement';
    expect(() =>
      assertReopened(
        { json: before, dom: 'same' },
        { json: after, dom: 'same' }
      )
    ).toThrow();
  });
  test('rejects changed DOM despite identical model', () => {
    const json = completeState();
    expect(() =>
      assertReopened({ json, dom: 'rendered' }, { json, dom: 'blank' })
    ).toThrow('DOM');
  });
});
