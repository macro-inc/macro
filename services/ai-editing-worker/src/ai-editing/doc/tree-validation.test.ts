/**
 * Random op sequences against a table must leave a tree the client will
 * accept. The write-boundary validator is the oracle; `$blockById` is what
 * keeps cell-id text ops from ever producing a failing tree.
 */
import { $isTableCellNode, $isTableRowNode } from '@lexical/table';
import { $getId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { validateEditorTree } from '@macro-inc/lexical-core/utils/editor-tree';
import { $getRoot, $isElementNode, type ElementNode } from 'lexical';
import { MersenneTwister19937, Random } from 'random-js';
import { describe, expect, it } from 'vitest';
import { read, setup } from '../ai-toolkit/_test-helpers';
import type { LexicalSession } from '../ai-toolkit/session';
import type { DocumentOp } from '../editor';
import { EditError } from '../editor';
import { Doc } from './doc';

function makeTable(rows: string[][]) {
  const { session, ids } = setup('intro');
  const doc = new Doc(session);
  doc.apply({
    kind: 'insertNode',
    ref: 't',
    spec: { block: 'table', rows },
    at: { after: ids[0]! },
  });
  return { session, doc, introId: ids[0]! };
}

function $tableNode(): ElementNode {
  const table = $getRoot()
    .getChildren()
    .find((n) => $isElementNode(n) && n.getType() === 'table');
  if (!table || !$isElementNode(table)) throw new Error('no table');
  return table;
}

function cellIds(session: LexicalSession): string[] {
  return read(session, () =>
    $tableNode()
      .getChildren()
      .filter($isTableRowNode)
      .flatMap((row) =>
        row
          .getChildren()
          .filter($isTableCellNode)
          .map((cell) => $getId(cell))
          .filter((id): id is string => id != null)
      )
  );
}

function paragraphIds(session: LexicalSession): string[] {
  return read(session, () =>
    $tableNode()
      .getChildren()
      .filter($isTableRowNode)
      .flatMap((row) =>
        row
          .getChildren()
          .filter($isTableCellNode)
          .flatMap((cell) =>
            cell
              .getChildren()
              .filter((child) => child.getType() === 'paragraph')
              .map((child) => $getId(child))
              .filter((id): id is string => id != null)
          )
      )
  );
}

function pick<T>(rng: Random, items: T[]): T {
  return items[rng.integer(0, items.length - 1)]!;
}

function randomOp(
  rng: Random,
  cells: string[],
  paragraphs: string[],
  introId: string
): DocumentOp {
  const target = pick(rng, [...cells, ...paragraphs, introId, 't']);
  switch (rng.integer(0, 6)) {
    case 0:
      return {
        kind: 'setText',
        node: target,
        text: `set-${rng.integer(0, 99)}`,
      };
    case 1:
      return { kind: 'appendText', node: target, text: 'x' };
    case 2:
      return { kind: 'prependText', node: target, text: 'y' };
    case 3:
      return {
        kind: 'insertText',
        node: target,
        at: 0,
        text: 'z',
      };
    case 4:
      return {
        kind: 'setCell',
        table: 't',
        row: rng.integer(0, 1),
        col: rng.integer(0, 1),
        text: `cell-${rng.integer(0, 99)}`,
      };
    case 5:
      return {
        kind: 'setBlockType',
        node: target,
        block: pick(rng, ['paragraph', 'heading', 'quote'] as const),
        level: 2,
      };
    default:
      return {
        kind: 'replaceText',
        node: target,
        find: 'a',
        to: 'b',
        scope: { kind: 'all' },
      };
  }
}

function assertValid(session: LexicalSession): void {
  const issues = read(session, () => validateEditorTree($getRoot()));
  expect(issues).toEqual([]);
}

describe('random op sequences stay client-valid', () => {
  it('keeps a 2x2 table well-formed across seeded random ops', () => {
    const rng = new Random(MersenneTwister19937.seed(20260813));
    for (let trial = 0; trial < 20; trial++) {
      const { session, doc, introId } = makeTable([
        ['H1', 'H2'],
        ['a', 'b'],
      ]);
      assertValid(session);
      for (let step = 0; step < 12; step++) {
        const op = randomOp(
          rng,
          cellIds(session),
          paragraphIds(session),
          introId
        );
        try {
          doc.apply(op);
        } catch (error) {
          expect(error).toBeInstanceOf(EditError);
        }
        assertValid(session);
      }
    }
  });
});
