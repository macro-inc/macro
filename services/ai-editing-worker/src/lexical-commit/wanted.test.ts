import { describe, expect, it } from 'vitest';
import { normalizeState, type SerializedNode } from './normalize';
import { MAX_BLOCKS, wantedState } from './wanted';

function paragraph(id: string, value: string): SerializedNode {
  return {
    type: 'paragraph',
    children: [
      {
        type: 'text',
        text: value,
        detail: 0,
        format: 0,
        mode: 'normal',
        style: '',
        version: 1,
        $: { id: `${id}.text` },
      },
    ],
    direction: null,
    format: '',
    indent: 0,
    textFormat: 0,
    textStyle: '',
    version: 1,
    $: { id },
  };
}

const base = normalizeState({
  root: {
    type: 'root',
    children: [paragraph('a', 'a'), paragraph('b', 'b'), paragraph('c', 'c')],
    direction: null,
    format: '',
    indent: 0,
    version: 1,
  },
});

function topLevel(outcome: ReturnType<typeof wantedState>) {
  if ('invalid' in outcome) throw new Error(outcome.invalid);
  return outcome.state.root.children!.map((node) => ({
    id: node.$?.id,
    text: node.children?.[0]?.text,
  }));
}

describe('wantedState', () => {
  it('replaces, places and removes blocks of the base', () => {
    const outcome = wantedState(
      base,
      [
        { id: 'c', after: null, node: paragraph('c', 'c, first') },
        { id: 'new', after: 'a', node: paragraph('new', 'new') },
      ],
      ['b']
    );
    expect(topLevel(outcome)).toEqual([
      { id: 'c', text: 'c, first' },
      { id: 'a', text: 'a' },
      { id: 'new', text: 'new' },
    ]);
  });

  it('normalizes what it builds', () => {
    const outcome = wantedState(
      base,
      [{ id: 'a', after: null, node: { ...paragraph('a', 'a!'), extra: 1 } }],
      []
    );
    expect(outcome).toEqual({ state: expect.anything() });
    if ('state' in outcome)
      expect(outcome.state.root.children![0]).not.toHaveProperty('extra');
  });

  it.each([
    [
      'more than the block limit',
      Array.from({ length: MAX_BLOCKS + 1 }, (_, index) => ({
        id: `n${index}`,
        after: index === 0 ? null : `n${index - 1}`,
        node: paragraph(`n${index}`, 'x'),
      })),
      [],
      /at most 500/,
    ],
    [
      'an unknown node type',
      [
        {
          id: 'a',
          after: null,
          node: { ...paragraph('a', 'a'), type: 'nope' },
        },
      ],
      [],
      /nope/,
    ],
    [
      'a node that is not an object',
      [{ id: 'a', after: null, node: 'a paragraph' }],
      [],
      /a/,
    ],
    [
      'a node whose id differs from its entry',
      [{ id: 'a', after: null, node: paragraph('other', 'a') }],
      [],
      /"a"/,
    ],
    [
      'the same block twice',
      [
        { id: 'a', after: null, node: paragraph('a', 'a') },
        { id: 'a', after: 'a', node: paragraph('a', 'a') },
      ],
      [],
      /"a"/,
    ],
    [
      'a duplicate id inside a block',
      [
        {
          id: 'new',
          after: 'c',
          node: {
            ...paragraph('new', 'x'),
            children: [paragraph('b', 'b').children![0]],
          },
        },
      ],
      [],
      /b\.text/,
    ],
    [
      'an after outside the wanted order',
      [{ id: 'new', after: 'missing', node: paragraph('new', 'x') }],
      [],
      /"missing"/,
    ],
    [
      'an after that is removed',
      [{ id: 'new', after: 'b', node: paragraph('new', 'x') }],
      ['b'],
      /"b"/,
    ],
    [
      'an after placed later in the list',
      [
        { id: 'one', after: 'two', node: paragraph('one', 'x') },
        { id: 'two', after: null, node: paragraph('two', 'y') },
      ],
      [],
      /"two"/,
    ],
    [
      'a removal that is also sent',
      [{ id: 'a', after: null, node: paragraph('a', 'a') }],
      ['a'],
      /"a"/,
    ],
    ['a removal that is not a base block', [], ['missing'], /"missing"/],
  ])('refuses %s', (_, blocks, removed, message) => {
    const outcome = wantedState(base, blocks, removed);
    expect(outcome).toEqual({ invalid: expect.stringMatching(message) });
  });
});
