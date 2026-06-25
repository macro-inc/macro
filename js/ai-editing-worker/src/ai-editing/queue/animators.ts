/**
 * Per-op animators: each turns ONE `DocumentOp` into the flat list of steps that
 * play it out. This is where animation intent lives — declared by the op, not
 * inferred from a diff. Primitives (`sweepSelect`, `typeText`, `focus`) compose
 * the common motions; `animate()` dispatches by op kind.
 *
 * Pure: an animator reads `docReader` to plan (lengths, match offsets) and emits
 * data. Nondeterminism comes only from `randomSource` (`integer`/`real`/
 * `direction`), so a fixed mock makes the whole action reproducible.
 */
import { match } from 'ts-pattern';
import type { DocReader } from '../doc';
import type {
  DocumentOp,
  NodeRef,
  NodeSpec,
  Offset,
  Position,
  Scope,
} from '../editor';
import type { RandomSource } from './random-source';
import type { DocumentOpStep, RandomRanges } from './types';

export type AnimatorCtx = {
  randomSource: RandomSource;
  docReader: DocReader;
  msPerChar: number;
  ranges: RandomRanges;
};

const cursor = (node: NodeRef, at: Offset): DocumentOpStep => ({
  kind: 'awareness',
  x: { type: 'cursor', node, at },
});
const highlight = (
  node: NodeRef,
  start: Offset,
  end: Offset
): DocumentOpStep => ({
  kind: 'awareness',
  x: { type: 'highlight', node, span: { start, end } },
});
const edit = (y: DocumentOp): DocumentOpStep => ({ kind: 'edit', y });

/**
 * Drag-select [start, end] on a node: rest the caret on one end (direction-biased)
 * for a short beat, then grow the selection to the full span in `highlightSweeps`
 * (0–5) increments, then settle. Selection is awareness-only — it reads against
 * the unmutated text, so offsets stay valid.
 */
function sweepSelect(
  node: NodeRef,
  start: Offset,
  end: Offset,
  ctx: AnimatorCtx
): DocumentOpStep[] {
  const { randomSource, ranges } = ctx;
  const leftward = randomSource.direction() === 'left';
  const len = Math.max(0, end - start);
  // Land the caret on the anchor and let it rest before the drag begins.
  const steps: DocumentOpStep[] = [
    cursor(node, leftward ? end : start),
    { kind: 'pause', ms: randomSource.integer(ranges.preSelectPauseMs) },
  ];
  const sweeps = randomSource.integer(ranges.highlightSweeps);
  for (let i = 1; i <= sweeps; i++) {
    const grow = Math.round((i / (sweeps + 1)) * len);
    steps.push(
      leftward
        ? highlight(node, end - grow, end)
        : highlight(node, start, start + grow)
    );
    steps.push({
      kind: 'pause',
      ms: randomSource.integer(ranges.sweepPauseMs),
    });
  }
  steps.push(highlight(node, start, end));
  steps.push({ kind: 'pause', ms: randomSource.integer(ranges.settlePauseMs) });
  return steps;
}

/** How many characters each typing keystroke emits. */
const TYPE_CHUNK = 3;

/** Type `text` into a node `TYPE_CHUNK` chars at a time from `from`, cursor
 *  following. A lead-in beat separates positioning (caret placement) from typing. */
function typeText(
  node: NodeRef,
  text: string,
  from: Offset,
  ctx: AnimatorCtx
): DocumentOpStep[] {
  const { randomSource, ranges, msPerChar } = ctx;
  if (text.length === 0) return [];
  const steps: DocumentOpStep[] = [
    { kind: 'pause', ms: randomSource.integer(ranges.settlePauseMs) },
  ];
  for (let k = 0; k < text.length; k += TYPE_CHUNK) {
    const chunk = text.slice(k, k + TYPE_CHUNK);
    steps.push(edit({ kind: 'insertText', node, at: from + k, text: chunk }));
    steps.push(cursor(node, from + k + chunk.length));
    steps.push({
      kind: 'pause',
      ms: Math.round(
        msPerChar * chunk.length * randomSource.real(ranges.typeJitter)
      ),
    });
  }
  return steps;
}

/** Brief focus on a node (cursor + settle pause), for structural ops. */
function focus(node: NodeRef, ctx: AnimatorCtx): DocumentOpStep[] {
  return [
    cursor(node, 0),
    { kind: 'pause', ms: ctx.randomSource.integer(ctx.ranges.settlePauseMs) },
  ];
}

/** Select the whole of a node's current text, then settle. */
function selectAll(node: NodeRef, ctx: AnimatorCtx): DocumentOpStep[] {
  return sweepSelect(node, 0, ctx.docReader.textLength(node), ctx);
}

/** Sweep each occurrence of a match (with a pause between), then one edit. */
function sweepEachThen(
  id: string,
  match: string,
  scope: Scope,
  finalEdit: DocumentOp,
  ctx: AnimatorCtx
): DocumentOpStep[] {
  const matches = ctx.docReader.locate(id, match, scope);
  const steps: DocumentOpStep[] = [];
  matches.forEach((m, i) => {
    if (i > 0)
      steps.push({
        kind: 'pause',
        ms: ctx.randomSource.integer(ctx.ranges.betweenNodesPauseMs),
      });
    steps.push(...sweepSelect(m.node, m.start, m.end, ctx));
  });
  steps.push(edit(finalEdit));
  return steps;
}

/** Replace a node's text by selecting all, deleting, and typing the new content. */
function retype(
  node: NodeRef,
  text: string,
  ctx: AnimatorCtx
): DocumentOpStep[] {
  const len = ctx.docReader.textLength(node);
  const steps: DocumentOpStep[] = [...selectAll(node, ctx)];
  if (len > 0) {
    steps.push({
      kind: 'pause',
      ms: ctx.randomSource.integer(ctx.ranges.preDeletePauseMs),
    });
    steps.push(edit({ kind: 'removeText', node, at: 0, len }));
    steps.push(cursor(node, 0));
  }
  steps.push(...typeText(node, text, 0, ctx));
  return steps;
}

/** Block specs whose text we type out (vs. build whole). */
const TYPED_BLOCKS = new Set(['paragraph', 'heading', 'quote', 'code']);

/** Move the caret to the insertion point (end of the anchor block) and pause —
 *  so an atomic block reads as "place the caret here, then it appears". */
function insertLead(at: Position, ctx: AnimatorCtx): DocumentOpStep[] {
  const settle: DocumentOpStep = {
    kind: 'pause',
    ms: ctx.randomSource.integer(ctx.ranges.settlePauseMs),
  };
  const anchor =
    'after' in at ? at.after : 'before' in at ? at.before : undefined;
  return anchor === undefined
    ? [settle]
    : [cursor(anchor, ctx.docReader.textLength(anchor)), settle];
}

/** Insert a block, animated by what it is:
 *  - typed text block (paragraph/heading/quote/code): insert empty, then type it.
 *  - divider: type `-`,`-`,`-` on a fresh line, beat, then it becomes a rule.
 *  - other atomic blocks (image/video/equation/list/table): caret to the spot,
 *    brief pause, it appears, caret moves into it. */
function animateInsertNode(
  o: Extract<DocumentOp, { kind: 'insertNode' }>,
  ctx: AnimatorCtx
): DocumentOpStep[] {
  const spec = o.spec;
  if ('block' in spec && TYPED_BLOCKS.has(spec.block)) {
    const text = (spec as { text?: string }).text ?? '';
    const steps: DocumentOpStep[] = [
      edit({
        kind: 'insertNode',
        ref: o.ref,
        spec: { ...spec, text: '' } as NodeSpec,
        at: o.at,
      }),
    ];
    if (text) {
      steps.push(cursor(o.ref, 0));
      steps.push(...typeText(o.ref, text, 0, ctx));
    }
    return steps;
  }
  if ('block' in spec && spec.block === 'list') {
    // Insert an empty list, then build it item by item: each item is a fresh
    // empty list item (the simulated Enter) the caret drops into and types out —
    // so a list reads as someone writing one bullet, hitting Enter, writing the next.
    const checked = spec.list === 'check' ? false : undefined;
    const steps: DocumentOpStep[] = [
      ...insertLead(o.at, ctx),
      edit({
        kind: 'insertNode',
        ref: o.ref,
        spec: { ...spec, items: [] } as NodeSpec,
        at: o.at,
      }),
    ];
    spec.items.forEach((text, i) => {
      const itemRef = `${o.ref}~li-${i}`;
      steps.push(
        edit({ kind: 'appendListItem', ref: itemRef, node: o.ref, checked })
      );
      steps.push(cursor(itemRef, 0));
      steps.push(...typeText(itemRef, text, 0, ctx));
    });
    return steps;
  }
  if ('block' in spec && spec.block === 'divider') {
    // Draft the dashes in a throwaway paragraph, then swap it for the rule.
    const draft = `${o.ref}~draft`;
    return [
      edit({
        kind: 'insertNode',
        ref: draft,
        spec: { block: 'paragraph', text: '' },
        at: o.at,
      }),
      cursor(draft, 0),
      ...typeText(draft, '---', 0, ctx),
      { kind: 'pause', ms: ctx.randomSource.integer(ctx.ranges.settlePauseMs) },
      edit({ kind: 'removeNode', node: draft }),
      edit({
        kind: 'insertNode',
        ref: o.ref,
        spec: { block: 'divider' },
        at: o.at,
      }),
    ];
  }
  return [
    ...insertLead(o.at, ctx),
    edit({ kind: 'insertNode', ref: o.ref, spec, at: o.at }),
    cursor(o.ref, 0),
  ];
}

export function animate(op: DocumentOp, ctx: AnimatorCtx): DocumentOpStep[] {
  return (
    match(op)
      .returnType<DocumentOpStep[]>()
      // inline: sweep each occurrence, then one match-based edit
      .with({ kind: 'formatText' }, (o) =>
        sweepEachThen(
          o.node,
          o.match,
          o.scope,
          {
            kind: 'formatText',
            node: o.node,
            match: o.match,
            format: o.format,
            on: o.on,
            scope: o.scope,
          },
          ctx
        )
      )
      .with({ kind: 'markText' }, (o) =>
        sweepEachThen(
          o.node,
          o.match,
          o.scope,
          {
            kind: 'markText',
            node: o.node,
            match: o.match,
            on: o.on,
            scope: o.scope,
          },
          ctx
        )
      )
      .with({ kind: 'linkText' }, (o) =>
        sweepEachThen(
          o.node,
          o.match,
          o.scope,
          {
            kind: 'linkText',
            node: o.node,
            match: o.match,
            url: o.url,
            scope: o.scope,
          },
          ctx
        )
      )
      .with({ kind: 'replaceText' }, (o) =>
        sweepEachThen(
          o.node,
          o.find,
          o.scope,
          {
            kind: 'replaceText',
            node: o.node,
            find: o.find,
            to: o.to,
            scope: o.scope,
          },
          ctx
        )
      )
      .with({ kind: 'clearFormat' }, (o) =>
        o.match === undefined
          ? [
              ...selectAll(o.node, ctx),
              edit({
                kind: 'clearFormat',
                node: o.node,
                match: undefined,
                scope: o.scope,
              }),
            ]
          : sweepEachThen(
              o.node,
              o.match,
              o.scope,
              {
                kind: 'clearFormat',
                node: o.node,
                match: o.match,
                scope: o.scope,
              },
              ctx
            )
      )
      .with({ kind: 'formatNode' }, (o) => [
        ...sweepSelect(o.node, 0, ctx.docReader.textLength(o.node), ctx),
        edit({ kind: 'formatNode', node: o.node, format: o.format, on: o.on }),
      ])
      .with({ kind: 'clearNodeFormat' }, (o) => [
        ...sweepSelect(o.node, 0, ctx.docReader.textLength(o.node), ctx),
        edit({ kind: 'clearNodeFormat', node: o.node }),
      ])
      // text content: type
      .with({ kind: 'setText' }, (o) => retype(o.node, o.text, ctx))
      .with({ kind: 'setEquation' }, (o) => [
        ...selectAll(o.node, ctx),
        edit({ kind: 'setEquation', node: o.node, tex: o.tex }),
      ])
      .with({ kind: 'appendText' }, (o) => {
        const len = ctx.docReader.textLength(o.node);
        return [cursor(o.node, len), ...typeText(o.node, o.text, len, ctx)];
      })
      .with({ kind: 'prependText' }, (o) => [
        cursor(o.node, 0),
        ...typeText(o.node, o.text, 0, ctx),
      ])
      // block type / list
      // select the line, then transform it — like a person selecting and restyling.
      .with({ kind: 'setBlockType' }, (o) => [
        ...selectAll(o.node, ctx),
        edit({
          kind: 'setBlockType',
          node: o.node,
          block: o.block,
          level: o.level,
          language: o.language,
        }),
      ])
      .with({ kind: 'setListType' }, (o) => [
        ...focus(o.nodes[0]!, ctx),
        edit({ kind: 'setListType', nodes: o.nodes, list: o.list }),
      ])
      .with({ kind: 'setChecked' }, (o) => [
        ...focus(o.node, ctx),
        edit({ kind: 'setChecked', node: o.node, checked: o.checked }),
      ])
      .with({ kind: 'setIndent' }, (o) => [
        ...focus(o.node, ctx),
        edit({ kind: 'setIndent', node: o.node, indent: o.indent }),
      ])
      // structure
      .with({ kind: 'insertNode' }, (o) => animateInsertNode(o, ctx))
      // caret to the offset, brief pause, the inline node appears.
      .with({ kind: 'insertInline' }, (o) => [
        cursor(o.node, o.at),
        {
          kind: 'pause',
          ms: ctx.randomSource.integer(ctx.ranges.settlePauseMs),
        },
        edit({
          kind: 'insertInline',
          ref: o.ref,
          node: o.node,
          at: o.at,
          spec: o.spec,
        }),
      ])
      // select the whole block first, so the user sees what is about to move.
      .with({ kind: 'moveNode' }, (o) => [
        ...selectAll(o.node, ctx),
        edit({ kind: 'moveNode', node: o.node, at: o.at }),
      ])
      // select the whole block, hesitate, then delete — destroying content is deliberate.
      .with({ kind: 'removeNode' }, (o) => [
        ...selectAll(o.node, ctx),
        {
          kind: 'pause',
          ms: ctx.randomSource.integer(ctx.ranges.preDeletePauseMs),
        },
        edit({ kind: 'removeNode', node: o.node }),
      ])
      // highlight each block being combined, in turn, then merge.
      .with({ kind: 'mergeBlocks' }, (o) => {
        const steps: DocumentOpStep[] = [];
        o.nodes.forEach((node, i) => {
          if (i > 0)
            steps.push({
              kind: 'pause',
              ms: ctx.randomSource.integer(ctx.ranges.betweenNodesPauseMs),
            });
          steps.push(...selectAll(node, ctx));
        });
        steps.push(
          edit({ kind: 'mergeBlocks', nodes: o.nodes, separator: o.separator })
        );
        return steps;
      })
      .with({ kind: 'insertListItemAfter' }, (o) => [
        ...insertLead({ after: o.node }, ctx),
        edit({
          kind: 'insertListItemAfter',
          ref: o.ref,
          node: o.node,
          text: '',
          list: o.list,
        }),
        cursor(o.ref, 0),
        ...typeText(o.ref, o.text, 0, ctx),
      ])
      .with({ kind: 'insertListItemBefore' }, (o) => [
        ...insertLead({ before: o.node }, ctx),
        edit({
          kind: 'insertListItemBefore',
          ref: o.ref,
          node: o.node,
          text: '',
          list: o.list,
        }),
        cursor(o.ref, 0),
        ...typeText(o.ref, o.text, 0, ctx),
      ])
      .with({ kind: 'removeListItem' }, (o) => [
        ...selectAll(o.node, ctx),
        {
          kind: 'pause',
          ms: ctx.randomSource.integer(ctx.ranges.preDeletePauseMs),
        },
        edit({ kind: 'removeListItem', node: o.node }),
      ])
      // tables
      .with({ kind: 'setCell' }, (o) =>
        retype(ctx.docReader.cellNode(o.table, o.row, o.col), o.text, ctx)
      )
      .with({ kind: 'addRow' }, (o) => [
        ...focus(o.table, ctx),
        edit({ kind: 'addRow', table: o.table, at: o.at }),
      ])
      .with({ kind: 'addColumn' }, (o) => [
        ...focus(o.table, ctx),
        edit({ kind: 'addColumn', table: o.table, at: o.at }),
      ])
      .with({ kind: 'removeRow' }, (o) => [
        ...focus(o.table, ctx),
        edit({ kind: 'removeRow', table: o.table, row: o.row }),
      ])
      .with({ kind: 'removeColumn' }, (o) => [
        ...focus(o.table, ctx),
        edit({ kind: 'removeColumn', table: o.table, col: o.col }),
      ])
      // media / date — focus the node, apply the property change
      .with({ kind: 'setImageAlt' }, (o) => [
        ...focus(o.node, ctx),
        edit({ kind: 'setImageAlt', node: o.node, alt: o.alt }),
      ])
      .with({ kind: 'setImageUrl' }, (o) => [
        ...focus(o.node, ctx),
        edit({ kind: 'setImageUrl', node: o.node, url: o.url }),
      ])
      .with({ kind: 'setVideoUrl' }, (o) => [
        ...focus(o.node, ctx),
        edit({ kind: 'setVideoUrl', node: o.node, url: o.url }),
      ])
      .with({ kind: 'setVideoControls' }, (o) => [
        ...focus(o.node, ctx),
        edit({ kind: 'setVideoControls', node: o.node, controls: o.controls }),
      ])
      .with({ kind: 'setDate' }, (o) => [
        ...focus(o.node, ctx),
        edit({
          kind: 'setDate',
          node: o.node,
          date: o.date,
          displayFormat: o.displayFormat,
        }),
      ])
      // animation primitives — pass through as-is (animators call these directly,
      // but they should never be dispatched through animate() in normal use)
      .with({ kind: 'insertText' }, (o) => [edit(o)])
      .with({ kind: 'removeText' }, (o) => [edit(o)])
      .with({ kind: 'appendListItem' }, (o) => [edit(o)])
      .exhaustive()
  );
}
