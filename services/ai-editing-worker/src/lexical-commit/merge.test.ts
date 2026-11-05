import { describe, expect, it } from 'vitest';
import { mergeStates } from './merge';
import type { SerializedNode, SerializedState } from './normalize';

function text(id: string, value: string): SerializedNode {
  return {
    type: 'text',
    text: value,
    detail: 0,
    format: 0,
    mode: 'normal',
    style: '',
    version: 1,
    $: { id },
  };
}

function paragraph(id: string, value: string): SerializedNode {
  return {
    type: 'paragraph',
    children: [text(`${id}.text`, value)],
    direction: null,
    format: '',
    indent: 0,
    textFormat: 0,
    textStyle: '',
    version: 1,
    $: { id },
  };
}

function item(
  id: string,
  value: string,
  attributes: Record<string, unknown> = {}
): SerializedNode {
  return {
    type: 'listitem',
    children: [text(`${id}.text`, value)],
    direction: null,
    format: '',
    indent: 0,
    value: 1,
    version: 1,
    ...attributes,
    $: { id },
  };
}

/** A list item that only holds a nested list. */
function holder(id: string, nested: SerializedNode): SerializedNode {
  return {
    type: 'listitem',
    children: [nested],
    direction: null,
    format: '',
    indent: 0,
    value: 1,
    version: 1,
    $: { id },
  };
}

function list(
  id: string,
  items: SerializedNode[],
  attributes: Record<string, unknown> = {}
): SerializedNode {
  return {
    type: 'task-list',
    children: items,
    direction: null,
    format: '',
    indent: 0,
    listType: 'bullet',
    start: 1,
    tag: 'ul',
    version: 1,
    ...attributes,
    $: { id },
  };
}

function cell(id: string, value: string): SerializedNode {
  return {
    type: 'tablecell',
    children: [paragraph(`${id}.paragraph`, value)],
    backgroundColor: null,
    colSpan: 1,
    headerState: 0,
    rowSpan: 1,
    direction: null,
    format: '',
    indent: 0,
    version: 1,
    $: { id },
  };
}

function row(id: string, cells: SerializedNode[]): SerializedNode {
  return {
    type: 'tablerow',
    children: cells,
    direction: null,
    format: '',
    indent: 0,
    version: 1,
    $: { id },
  };
}

function table(id: string, rows: SerializedNode[]): SerializedNode {
  return {
    type: 'table',
    children: rows,
    colWidths: null,
    direction: null,
    format: '',
    indent: 0,
    version: 1,
    $: { id },
  };
}

function state(...children: SerializedNode[]): SerializedState {
  return {
    root: {
      type: 'root',
      children,
      direction: null,
      format: '',
      indent: 0,
      version: 1,
    },
  };
}

/** Top-level texts in order, a quick view of a merged document. */
function texts(merged: SerializedState): string[] {
  const textOf = (node: SerializedNode): string =>
    typeof node.text === 'string'
      ? node.text
      : (node.children ?? []).map(textOf).join('|');
  return (merged.root.children ?? []).map(textOf);
}

function merged(
  base: SerializedState,
  live: SerializedState,
  wanted: SerializedState
) {
  const outcome = mergeStates(base, live, wanted);
  if ('conflicts' in outcome)
    throw new Error(
      `unexpected conflicts ${JSON.stringify(outcome.conflicts)}`
    );
  return outcome;
}

describe('mergeStates', () => {
  it('keeps a collaborator edit to a block the program left alone', () => {
    const base: SerializedState = {
      root: {
        type: 'root',
        direction: null,
        format: '',
        indent: 0,
        version: 1,
        children: [
          {
            type: 'paragraph',
            direction: null,
            format: '',
            indent: 0,
            textFormat: 0,
            textStyle: '',
            version: 1,
            $: { id: 'intro' },
            children: [
              {
                type: 'text',
                text: 'Ship in Q3.',
                detail: 0,
                format: 0,
                mode: 'normal',
                style: '',
                version: 1,
                $: { id: 'intro-text' },
              },
            ],
          },
          {
            type: 'paragraph',
            direction: null,
            format: '',
            indent: 0,
            textFormat: 0,
            textStyle: '',
            version: 1,
            $: { id: 'outro' },
            children: [
              {
                type: 'text',
                text: 'Thanks.',
                detail: 0,
                format: 0,
                mode: 'normal',
                style: '',
                version: 1,
                $: { id: 'outro-text' },
              },
            ],
          },
        ],
      },
    };
    const live: SerializedState = structuredClone(base);
    live.root.children![0]!.children![0]!.text = 'We ship in Q3.';
    const wanted: SerializedState = structuredClone(base);
    wanted.root.children![1]!.children![0]!.text = 'Thanks, all.';

    const outcome = mergeStates(base, live, wanted);

    const expected: SerializedState = structuredClone(base);
    expected.root.children![0]!.children![0]!.text = 'We ship in Q3.';
    expected.root.children![1]!.children![0]!.text = 'Thanks, all.';
    expect(outcome).toEqual({ state: expected, changed: true });
  });

  describe('an atomic node', () => {
    const base = state(paragraph('a', 'one'));

    it('takes live when the program did not touch it', () => {
      const live = state(paragraph('a', 'one, edited'));
      expect(merged(base, live, base)).toEqual({ state: live, changed: false });
    });

    it('takes wanted when nobody else touched it', () => {
      const wanted = state(paragraph('a', 'one, programmed'));
      expect(merged(base, base, wanted)).toEqual({
        state: wanted,
        changed: true,
      });
    });

    it('keeps live when both made the same change', () => {
      const both = state(paragraph('a', 'same'));
      expect(merged(base, both, both)).toEqual({ state: both, changed: false });
    });

    it('conflicts when both changed it differently', () => {
      expect(
        mergeStates(
          base,
          state(paragraph('a', 'human')),
          state(paragraph('a', 'program'))
        )
      ).toEqual({ conflicts: [{ id: 'a', reason: 'changed' }] });
    });

    it('compares a node whole, so a format change and a text change conflict', () => {
      const live = state(paragraph('a', 'one!'));
      const wanted = state({ ...paragraph('a', 'one'), format: 'center' });
      expect(mergeStates(base, live, wanted)).toEqual({
        conflicts: [{ id: 'a', reason: 'changed' }],
      });
    });
  });

  describe('a container child', () => {
    const base = state(paragraph('a', 'one'), paragraph('b', 'two'));

    it('in all three is merged recursively', () => {
      const base = state(list('l', [item('x', 'x'), item('y', 'y')]));
      const live = state(list('l', [item('x', 'x by human'), item('y', 'y')]));
      const wanted = state(
        list('l', [item('x', 'x'), item('y', 'y', { checked: true })])
      );
      expect(merged(base, live, wanted).state).toEqual(
        state(
          list('l', [
            item('x', 'x by human'),
            item('y', 'y', { checked: true, value: 2 }),
          ])
        )
      );
    });

    it('removed by the program is removed when live left it alone', () => {
      const wanted = state(paragraph('a', 'one'));
      expect(merged(base, base, wanted)).toEqual({
        state: wanted,
        changed: true,
      });
    });

    it('removed by the program conflicts when live changed it', () => {
      const live = state(paragraph('a', 'one'), paragraph('b', 'two, edited'));
      const wanted = state(paragraph('a', 'one'));
      expect(mergeStates(base, live, wanted)).toEqual({
        conflicts: [{ id: 'b', reason: 'changed' }],
      });
    });

    it('removed by live stays removed when the program left it alone', () => {
      const live = state(paragraph('a', 'one'));
      expect(merged(base, live, base)).toEqual({ state: live, changed: false });
    });

    it('removed by live conflicts when the program changed it', () => {
      const live = state(paragraph('a', 'one'));
      const wanted = state(paragraph('a', 'one'), paragraph('b', 'two!'));
      expect(mergeStates(base, live, wanted)).toEqual({
        conflicts: [{ id: 'b', reason: 'removed' }],
      });
    });

    it('removed by both stays removed', () => {
      const both = state(paragraph('a', 'one'));
      expect(merged(base, both, both)).toEqual({ state: both, changed: false });
    });

    it('inserted by live is kept', () => {
      const live = state(
        paragraph('a', 'one'),
        paragraph('human', 'typed'),
        paragraph('b', 'two')
      );
      expect(merged(base, live, base)).toEqual({ state: live, changed: false });
    });

    it('inserted by the program goes after its wanted predecessor', () => {
      const wanted = state(
        paragraph('a', 'one'),
        paragraph('new', 'inserted'),
        paragraph('b', 'two')
      );
      expect(merged(base, base, wanted)).toEqual({
        state: wanted,
        changed: true,
      });
    });

    it('inserted by both, identically, is kept once', () => {
      const both = state(
        paragraph('a', 'one'),
        paragraph('new', 'inserted'),
        paragraph('b', 'two')
      );
      expect(merged(base, both, both)).toEqual({ state: both, changed: false });
    });

    it('inserted by both, differently, conflicts', () => {
      const live = state(
        paragraph('a', 'one'),
        paragraph('new', 'by human'),
        paragraph('b', 'two')
      );
      const wanted = state(
        paragraph('a', 'one'),
        paragraph('new', 'by program'),
        paragraph('b', 'two')
      );
      expect(mergeStates(base, live, wanted)).toEqual({
        conflicts: [{ id: 'new', reason: 'changed' }],
      });
    });

    it('reports every conflict, not just the first', () => {
      const live = state(paragraph('a', 'human a'), paragraph('b', 'human b'));
      const wanted = state(paragraph('a', 'program a'));
      expect(mergeStates(base, live, wanted)).toEqual({
        conflicts: [
          { id: 'a', reason: 'changed' },
          { id: 'b', reason: 'changed' },
        ],
      });
    });
  });

  describe('order', () => {
    const base = state(
      paragraph('a', 'a'),
      paragraph('b', 'b'),
      paragraph('c', 'c'),
      paragraph('d', 'd'),
      paragraph('e', 'e')
    );

    it('moves what the program moved and keeps a live edit elsewhere', () => {
      const live = state(
        paragraph('a', 'a'),
        paragraph('b', 'b by human'),
        paragraph('c', 'c'),
        paragraph('d', 'd'),
        paragraph('e', 'e')
      );
      const wanted = state(
        paragraph('a', 'a'),
        paragraph('b', 'b'),
        paragraph('e', 'e'),
        paragraph('c', 'c'),
        paragraph('d', 'd')
      );
      expect(texts(merged(base, live, wanted).state)).toEqual([
        'a',
        'b by human',
        'e',
        'c',
        'd',
      ]);
    });

    it('keeps what live moved while the program edits another block', () => {
      const live = state(
        paragraph('d', 'd'),
        paragraph('a', 'a'),
        paragraph('b', 'b'),
        paragraph('c', 'c'),
        paragraph('e', 'e')
      );
      const wanted = state(
        paragraph('a', 'a'),
        paragraph('b', 'b'),
        paragraph('c', 'c, programmed'),
        paragraph('d', 'd'),
        paragraph('e', 'e')
      );
      expect(texts(merged(base, live, wanted).state)).toEqual([
        'd',
        'a',
        'b',
        'c, programmed',
        'e',
      ]);
    });

    it('counts only blocks outside the longest common subsequence as moved', () => {
      // Moving `a` to the end shifts every other block's index; only `a` moved,
      // so a concurrent move of `c` by live is not a conflict.
      const live = state(
        paragraph('a', 'a'),
        paragraph('b', 'b'),
        paragraph('d', 'd'),
        paragraph('c', 'c'),
        paragraph('e', 'e')
      );
      const wanted = state(
        paragraph('b', 'b'),
        paragraph('c', 'c'),
        paragraph('d', 'd'),
        paragraph('e', 'e'),
        paragraph('a', 'a')
      );
      expect(texts(merged(base, live, wanted).state)).toEqual([
        'b',
        'd',
        'c',
        'e',
        'a',
      ]);
    });

    it('accepts the same move by both sides', () => {
      const both = state(
        paragraph('a', 'a'),
        paragraph('d', 'd'),
        paragraph('b', 'b'),
        paragraph('c', 'c'),
        paragraph('e', 'e')
      );
      expect(merged(base, both, both)).toEqual({ state: both, changed: false });
    });

    it('conflicts when both moved a block to different predecessors', () => {
      const live = state(
        paragraph('d', 'd'),
        paragraph('a', 'a'),
        paragraph('b', 'b'),
        paragraph('c', 'c'),
        paragraph('e', 'e')
      );
      const wanted = state(
        paragraph('a', 'a'),
        paragraph('d', 'd'),
        paragraph('b', 'b'),
        paragraph('c', 'c'),
        paragraph('e', 'e')
      );
      expect(mergeStates(base, live, wanted)).toEqual({
        conflicts: [{ id: 'd', reason: 'moved' }],
      });
    });

    it('places an insertion after its nearest predecessor that survived', () => {
      const live = state(
        paragraph('a', 'a'),
        paragraph('c', 'c'),
        paragraph('d', 'd'),
        paragraph('e', 'e')
      );
      const wanted = state(
        paragraph('a', 'a'),
        paragraph('b', 'b'),
        paragraph('new', 'new'),
        paragraph('c', 'c'),
        paragraph('d', 'd'),
        paragraph('e', 'e')
      );
      expect(texts(merged(base, live, wanted).state)).toEqual([
        'a',
        'new',
        'c',
        'd',
        'e',
      ]);
    });

    it('places an insertion first when no wanted predecessor survived', () => {
      const live = state(
        paragraph('b', 'b'),
        paragraph('c', 'c'),
        paragraph('d', 'd'),
        paragraph('e', 'e')
      );
      const wanted = state(
        paragraph('a', 'a'),
        paragraph('new', 'new'),
        paragraph('b', 'b'),
        paragraph('c', 'c'),
        paragraph('d', 'd'),
        paragraph('e', 'e')
      );
      expect(texts(merged(base, live, wanted).state)).toEqual([
        'new',
        'b',
        'c',
        'd',
        'e',
      ]);
    });

    it('keeps a live insertion beside a program insertion at the same spot', () => {
      const live = state(
        paragraph('a', 'a'),
        paragraph('human', 'human'),
        paragraph('b', 'b'),
        paragraph('c', 'c'),
        paragraph('d', 'd'),
        paragraph('e', 'e')
      );
      const wanted = state(
        paragraph('a', 'a'),
        paragraph('program', 'program'),
        paragraph('b', 'b'),
        paragraph('c', 'c'),
        paragraph('d', 'd'),
        paragraph('e', 'e')
      );
      expect(texts(merged(base, live, wanted).state)).toEqual([
        'a',
        'program',
        'human',
        'b',
        'c',
        'd',
        'e',
      ]);
    });
  });

  describe('containers', () => {
    it('merges edits by both sides to different items of a nested list', () => {
      const nested = (first: SerializedNode, second: SerializedNode) =>
        list('nested', [first, second]);
      const base = state(
        list('outer', [
          item('top', 'top'),
          holder('holder', nested(item('n1', 'n1'), item('n2', 'n2'))),
        ])
      );
      const live = state(
        list('outer', [
          item('top', 'top'),
          holder('holder', nested(item('n1', 'n1 by human'), item('n2', 'n2'))),
        ])
      );
      const wanted = state(
        list('outer', [
          item('top', 'top'),
          holder(
            'holder',
            nested(item('n1', 'n1'), item('n2', 'n2', { checked: true }))
          ),
        ])
      );
      expect(texts(merged(base, live, wanted).state)).toEqual([
        'top|n1 by human|n2',
      ]);
      const outer = merged(base, live, wanted).state.root.children![0]!;
      const nestedList = outer.children![1]!.children![0]!;
      expect(nestedList.children![1]).toMatchObject({
        $: { id: 'n2' },
        checked: true,
      });
    });

    it('conflicts when both sides edit the same nested item', () => {
      const base = state(
        list('outer', [holder('holder', list('nested', [item('n1', 'n1')]))])
      );
      const live = state(
        list('outer', [
          holder('holder', list('nested', [item('n1', 'n1 by human')])),
        ])
      );
      const wanted = state(
        list('outer', [
          holder('holder', list('nested', [item('n1', 'n1 by program')])),
        ])
      );
      expect(mergeStates(base, live, wanted)).toEqual({
        conflicts: [{ id: 'n1', reason: 'changed' }],
      });
    });

    it('treats a list item with text as atomic', () => {
      const base = state(list('l', [item('x', 'x')]));
      const live = state(list('l', [item('x', 'x by human')]));
      const wanted = state(list('l', [item('x', 'x', { checked: true })]));
      expect(mergeStates(base, live, wanted)).toEqual({
        conflicts: [{ id: 'x', reason: 'changed' }],
      });
    });

    it('merges edits to different cells of a table', () => {
      const base = state(
        table('t', [row('r1', [cell('c1', '1'), cell('c2', '2')])])
      );
      const live = state(
        table('t', [row('r1', [cell('c1', '1 by human'), cell('c2', '2')])])
      );
      const wanted = state(
        table('t', [row('r1', [cell('c1', '1'), cell('c2', '2 by program')])])
      );
      expect(merged(base, live, wanted).state).toEqual(
        state(
          table('t', [
            row('r1', [cell('c1', '1 by human'), cell('c2', '2 by program')]),
          ])
        )
      );
    });

    it('conflicts on edits to the same cell', () => {
      const base = state(table('t', [row('r1', [cell('c1', '1')])]));
      const live = state(table('t', [row('r1', [cell('c1', 'human')])]));
      const wanted = state(table('t', [row('r1', [cell('c1', 'program')])]));
      expect(mergeStates(base, live, wanted)).toEqual({
        conflicts: [{ id: 'c1.paragraph', reason: 'changed' }],
      });
    });

    it('merges a container attribute change with a child edit', () => {
      const base = state(list('l', [item('x', 'x'), item('y', 'y')]));
      const live = state(
        list('l', [item('x', 'x'), item('y', 'y')], {
          listType: 'number',
          tag: 'ol',
        })
      );
      const wanted = state(list('l', [item('x', 'x'), item('y', 'y, edited')]));
      expect(merged(base, live, wanted).state).toEqual(
        state(
          list('l', [item('x', 'x'), item('y', 'y, edited', { value: 2 })], {
            listType: 'number',
            tag: 'ol',
          })
        )
      );
    });

    it('conflicts when both change a container attribute differently', () => {
      const base = state(list('l', [item('x', 'x')]));
      const live = state(list('l', [item('x', 'x')], { start: 3 }));
      const wanted = state(list('l', [item('x', 'x')], { start: 5 }));
      expect(mergeStates(base, live, wanted)).toEqual({
        conflicts: [{ id: 'l', reason: 'changed' }],
      });
    });

    it('ignores list item numbering shifted by a live insertion', () => {
      const base = state(
        list('l', [item('x', 'x'), item('y', 'y', { value: 2 })])
      );
      const live = state(
        list('l', [
          item('human', 'human'),
          item('x', 'x', { value: 2 }),
          item('y', 'y', { value: 3 }),
        ])
      );
      const wanted = state(
        list('l', [item('x', 'x'), item('y', 'y', { value: 2, checked: true })])
      );
      expect(merged(base, live, wanted).state).toEqual(
        state(
          list('l', [
            item('human', 'human'),
            item('x', 'x', { value: 2 }),
            item('y', 'y', { value: 3, checked: true }),
          ])
        )
      );
    });

    it('moves a block from the document into a table cell', () => {
      const base = state(
        paragraph('loose', 'loose'),
        table('t', [row('r1', [cell('c1', '1')])])
      );
      const moved = {
        ...cell('c1', '1'),
        children: [paragraph('c1.paragraph', '1'), paragraph('loose', 'loose')],
      };
      const wanted = state(table('t', [row('r1', [moved])]));
      expect(merged(base, base, wanted)).toEqual({
        state: wanted,
        changed: true,
      });
    });

    it('conflicts when both sides move a block into different containers', () => {
      const base = state(
        paragraph('loose', 'loose'),
        table('t', [row('r1', [cell('c1', '1'), cell('c2', '2')])])
      );
      const into = (target: string) =>
        state(
          table('t', [
            row('r1', [
              target === 'c1'
                ? {
                    ...cell('c1', '1'),
                    children: [
                      paragraph('c1.paragraph', '1'),
                      paragraph('loose', 'loose'),
                    ],
                  }
                : cell('c1', '1'),
              target === 'c2'
                ? {
                    ...cell('c2', '2'),
                    children: [
                      paragraph('c2.paragraph', '2'),
                      paragraph('loose', 'loose'),
                    ],
                  }
                : cell('c2', '2'),
            ]),
          ])
        );
      expect(mergeStates(base, into('c1'), into('c2'))).toEqual({
        conflicts: [{ id: 'loose', reason: 'moved' }],
      });
    });
  });
});
