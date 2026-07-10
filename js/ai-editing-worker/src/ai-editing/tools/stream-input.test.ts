import type { TextStreamPart, ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';
import { StreamingToolInput, ToolInputRouter } from './stream-input';

type TestElement = Record<string, unknown>;

function collector() {
  const elements: Array<{ element: TestElement; index: number }> = [];
  const input = new StreamingToolInput<TestElement>({
    elementsField: 'edits',
    onElement: (element, index) => elements.push({ element, index }),
  });
  return { elements, input };
}

describe('StreamingToolInput — elements', () => {
  it('emits element i only once element i+1 starts, and the last on end', async () => {
    const { elements, input } = collector();
    await input.push('{"edits":[{"editing_instruction":"first');
    expect(elements).toEqual([]);
    // element 0 is closed but still trailing — not safe yet
    await input.push(' edit"}');
    expect(elements).toEqual([]);
    await input.push(',{"editing_instruction":"second');
    expect(elements).toEqual([
      { element: { editing_instruction: 'first edit' }, index: 0 },
    ]);
    await input.push(' edit"}]}');
    expect(elements).toHaveLength(1);
    await input.end();
    expect(elements).toEqual([
      { element: { editing_instruction: 'first edit' }, index: 0 },
      { element: { editing_instruction: 'second edit' }, index: 1 },
    ]);
  });

  it('never emits a half-written trailing element', async () => {
    const { elements, input } = collector();
    await input.push('{"edits":[{"editing_instruction":"convert node ab');
    await input.push('c123 to a heading","other":"He');
    expect(elements).toEqual([]);
  });

  it('handles many elements arriving in one delta', async () => {
    const { elements, input } = collector();
    await input.push('{"edits":[{"a":1},{"a":2},{"a":3');
    expect(elements.map((e) => e.index)).toEqual([0, 1]);
    await input.end();
    expect(elements.map((e) => e.index)).toEqual([0, 1, 2]);
  });

  it('ignores non-array field values (malformed calls)', async () => {
    const { elements, input } = collector();
    await input.push('{"edits":"\\n<parameter name=\\"editing_instruction');
    await input.push('\\">Convert the list item</parameter>"}');
    await input.end();
    expect(elements).toEqual([]);
  });

  it('ignores unparseable input', async () => {
    const { elements, input } = collector();
    await input.push('not json at all <<<');
    await input.end();
    expect(elements).toEqual([]);
  });
});

describe('ToolInputRouter', () => {
  const start = (id: string, toolName: string) =>
    ({ type: 'tool-input-start', id, toolName }) as TextStreamPart<ToolSet>;
  const delta = (id: string, d: string) =>
    ({ type: 'tool-input-delta', id, delta: d }) as TextStreamPart<ToolSet>;
  const end = (id: string) =>
    ({ type: 'tool-input-end', id }) as TextStreamPart<ToolSet>;

  function routed() {
    const emitted: Array<{ id: string; element: TestElement; index: number }> =
      [];
    const router = new ToolInputRouter<TestElement>(
      'dispatch',
      (id) =>
        new StreamingToolInput<TestElement>({
          elementsField: 'edits',
          onElement: (element, index) => emitted.push({ id, element, index }),
        })
    );
    return { emitted, router };
  }

  it('routes deltas per call id and tags emissions with it', async () => {
    const { emitted, router } = routed();
    await router.handle(start('call-1', 'dispatch'));
    await router.handle(start('call-2', 'dispatch'));
    await router.handle(delta('call-1', '{"edits":[{"a":1},'));
    await router.handle(delta('call-2', '{"edits":[{"b":1}]}'));
    await router.handle(delta('call-1', '{"a":2}]}'));
    await router.handle(end('call-1'));
    await router.handle(end('call-2'));
    expect(emitted).toEqual([
      { id: 'call-1', element: { a: 1 }, index: 0 },
      { id: 'call-1', element: { a: 2 }, index: 1 },
      { id: 'call-2', element: { b: 1 }, index: 0 },
    ]);
  });

  it('ignores other tools and unknown part kinds', async () => {
    const { emitted, router } = routed();
    await router.handle(start('call-1', 'reportBlocked'));
    await router.handle(delta('call-1', '{"edits":[{"a":1},{"a":2}]}'));
    await router.handle(end('call-1'));
    await router.handle({
      type: 'text-delta',
      id: 't',
      text: 'hi',
    } as TextStreamPart<ToolSet>);
    expect(emitted).toEqual([]);
  });
});
