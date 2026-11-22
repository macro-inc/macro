/**
 * Source-of-truth cases for the native editor's AI op applier
 * (`macro_document_model` group C). Each case seeds a real Lexical session,
 * applies the ops through `Doc` exactly as the client's `applyAiOps` does
 * (one discrete update per op, stopping at the first failure), and records
 * the seed and resulting serialized states. The Rust tests replay the same
 * seed and ops natively and must reach the same state.
 */
import type { SerializedEditorState } from 'lexical';
import { setup } from '../ai-toolkit/_test-helpers';
import type { DocumentOp } from '../editor';
import { Doc } from './doc';

/** Ops address seed blocks by top-level index; the generator resolves real ids. */
type BlockOp = DocumentOp extends infer Op
  ? Op extends { node: unknown }
    ? Omit<Op, 'node'> & { node: number }
    : never
  : never;

type CorpusCase = {
  readonly name: string;
  readonly markdown: string;
  readonly ops: readonly BlockOp[];
};

export type CorpusEntry = {
  readonly name: string;
  readonly seed: SerializedEditorState;
  readonly ops: readonly DocumentOp[];
  /** State after every op that applied; earlier ops stay when a later one fails. */
  readonly state: SerializedEditorState;
  /** Index of the op that failed, if any; later ops were not attempted. */
  readonly failedAt: number | null;
};

const all = { kind: 'all' } as const;
/** `nth` is 1-based; 0 matches no occurrence. */
const second = { kind: 'nth', n: 2 } as const;
const zeroth = { kind: 'nth', n: 0 } as const;

/** Text-content ops: insertText, removeText, setText, appendText, prependText, replaceText. */
export const TEXT_CASES: readonly CorpusCase[] = [
  {
    name: 'insertText in a plain paragraph',
    markdown: 'Alpha gamma',
    ops: [{ kind: 'insertText', node: 0, at: 6, text: 'beta ' }],
  },
  {
    name: 'insertText after a bold run stays plain',
    markdown: 'a **b**',
    ops: [{ kind: 'insertText', node: 0, at: 3, text: ' c' }],
  },
  {
    name: 'insertText before a bold run stays plain',
    markdown: '**b** c',
    ops: [{ kind: 'insertText', node: 0, at: 0, text: 'a ' }],
  },
  {
    name: 'removeText within one run',
    markdown: 'Alpha beta gamma',
    ops: [{ kind: 'removeText', node: 0, at: 5, len: 5 }],
  },
  {
    name: 'removeText across a format boundary',
    markdown: 'plain **bold** tail',
    ops: [{ kind: 'removeText', node: 0, at: 3, len: 9 }],
  },
  {
    name: 'setText replaces a multi-run block',
    markdown: 'one **two** three',
    ops: [{ kind: 'setText', node: 0, text: 'replaced' }],
  },
  {
    name: 'setText on each of two blocks',
    markdown: 'Alpha beta gamma\n\nSecond line',
    ops: [
      { kind: 'setText', node: 0, text: 'Omega beta gamma' },
      { kind: 'setText', node: 1, text: 'Final line' },
    ],
  },
  {
    name: 'setText on a list container fails',
    markdown: '- one\n- two',
    ops: [{ kind: 'setText', node: 0, text: 'flat' }],
  },
  {
    name: 'appendText to a paragraph ending in bold',
    markdown: 'start **bold**',
    ops: [{ kind: 'appendText', node: 0, text: ' end' }],
  },
  {
    name: 'prependText to a paragraph starting in italic',
    markdown: '*lead* rest',
    ops: [{ kind: 'prependText', node: 0, text: 'Intro ' }],
  },
  {
    name: 'replaceText second occurrence',
    markdown: 'cat and cat',
    ops: [
      { kind: 'replaceText', node: 0, find: 'cat', to: 'dog', scope: second },
    ],
  },
  {
    name: 'replaceText nth 0 matches nothing and fails',
    markdown: 'cat and cat',
    ops: [
      { kind: 'replaceText', node: 0, find: 'cat', to: 'dog', scope: zeroth },
    ],
  },
  {
    name: 'replaceText all occurrences',
    markdown: 'cat and cat',
    ops: [{ kind: 'replaceText', node: 0, find: 'cat', to: 'dog', scope: all }],
  },
  {
    name: 'replaceText inside a bold run keeps the format',
    markdown: 'say **hello world** now',
    ops: [
      { kind: 'replaceText', node: 0, find: 'world', to: 'there', scope: all },
    ],
  },
  {
    name: 'a missed replaceText keeps the earlier op and stops',
    markdown: 'Alpha\n\nBeta',
    ops: [
      { kind: 'setText', node: 0, text: 'Omega' },
      { kind: 'replaceText', node: 1, find: 'missing', to: 'x', scope: all },
      { kind: 'setText', node: 1, text: 'never applied' },
    ],
  },
];

/** Apply like the client's `applyAiOps`: in order, stopping at the first throw. */
export function generate(cases: readonly CorpusCase[]): CorpusEntry[] {
  return cases.map((testCase) => {
    const { session, ids } = setup(testCase.markdown);
    const seed = session.editor.getEditorState().toJSON();
    const ops = testCase.ops.map((op): DocumentOp => {
      const id = ids[op.node];
      if (id === undefined)
        throw new Error(`${testCase.name}: no top-level block ${op.node}`);
      return { ...op, node: id } as DocumentOp;
    });
    const doc = new Doc(session);
    let failedAt: number | null = null;
    for (const [index, op] of ops.entries()) {
      try {
        doc.apply(op);
      } catch {
        failedAt = index;
        break;
      }
    }
    // Seed ids are random per session: rename them in order of appearance so
    // the corpus is deterministic, and mark ids an op minted as `<new>`.
    const names = new Map<string, string>();
    collectIds(seed, (id) => {
      if (!names.has(id))
        names.set(id, `s${String(names.size).padStart(7, '0')}`);
    });
    const rename = (id: string) => names.get(id) ?? NEW_ID;
    return {
      name: testCase.name,
      seed: renameIds(seed, rename) as SerializedEditorState,
      ops: testCase.ops.map(
        (op) => ({ ...op, node: rename(ids[op.node] ?? '') }) as DocumentOp
      ),
      state: renameIds(
        session.editor.getEditorState().toJSON(),
        rename
      ) as SerializedEditorState,
      failedAt,
    };
  });
}

/** Placeholder for an id an op minted; the native side normalizes the same way. */
export const NEW_ID = '<new>';

function collectIds(value: unknown, visit: (id: string) => void): void {
  if (Array.isArray(value)) for (const child of value) collectIds(child, visit);
  else if (value !== null && typeof value === 'object')
    for (const [key, child] of Object.entries(value)) {
      if (key === '$' && child !== null && typeof child === 'object') {
        const id = (child as Record<string, unknown>).id;
        if (typeof id === 'string') visit(id);
      } else collectIds(child, visit);
    }
}

function renameIds(value: unknown, rename: (id: string) => string): unknown {
  if (Array.isArray(value)) return value.map((v) => renameIds(v, rename));
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === '$' && child !== null && typeof child === 'object') {
      const state = { ...(child as Record<string, unknown>) };
      if (typeof state.id === 'string') state.id = rename(state.id);
      out[key] = state;
    } else out[key] = renameIds(child, rename);
  }
  return out;
}

/** A seed node: a top-level block index, or a child path from it (for text ids). */
type Address = number | readonly number[];

/** Seed addresses for `node`, `nodes` and `at.after` / `at.before`; refs stay literal strings. */
type BlockCase = {
  readonly name: string;
  readonly markdown: string;
  readonly ops: readonly unknown[];
  /** Source applies the ops without error and changes nothing. */
  readonly unchanged?: true;
};

export type BlockCorpusEntry = CorpusEntry & {
  /** Refs the ops minted; kept verbatim in `ops` and `state`. */
  readonly refs: readonly string[];
};

const block = (i: number) => i;

/** Block-structure ops (phase B1): insertNode, removeNode, moveNode, mergeBlocks,
 *  setBlockType, formatNode, clearNodeFormat, setIndent. */
export const BLOCK_CASES: readonly BlockCase[] = [
  {
    name: 'insertNode paragraph after the first block',
    markdown: 'Alpha\n\nBeta',
    ops: [
      {
        kind: 'insertNode',
        ref: 'ref-p1',
        spec: { block: 'paragraph', text: 'Inserted' },
        at: { after: block(0) },
      },
    ],
  },
  {
    name: 'insertNode heading before the first block',
    markdown: 'Alpha',
    ops: [
      {
        kind: 'insertNode',
        ref: 'ref-h2',
        spec: { block: 'heading', level: 2, text: 'Title' },
        at: { before: block(0) },
      },
    ],
  },
  {
    name: 'insertNode quote appended to the root',
    markdown: 'Alpha',
    ops: [
      {
        kind: 'insertNode',
        ref: 'ref-q',
        spec: { block: 'quote', text: 'Said' },
        at: { appendToRoot: true },
      },
    ],
  },
  {
    name: 'insertNode code prepended to the root',
    markdown: 'Alpha',
    ops: [
      {
        kind: 'insertNode',
        ref: 'ref-code',
        spec: { block: 'code', language: 'ts', text: 'let x = 1;' },
        at: { prependToRoot: true },
      },
    ],
  },
  {
    name: 'insertNode bullet list',
    markdown: 'Alpha',
    ops: [
      {
        kind: 'insertNode',
        ref: 'ref-list',
        spec: { block: 'list', list: 'bullet', items: ['one', 'two'] },
        at: { after: block(0) },
      },
    ],
  },
  {
    name: 'insertNode check list',
    markdown: 'Alpha',
    ops: [
      {
        kind: 'insertNode',
        ref: 'ref-check',
        spec: { block: 'list', list: 'check', items: ['todo'] },
        at: { after: block(0) },
      },
    ],
  },
  {
    name: 'insertNode table with a header row',
    markdown: 'Alpha',
    ops: [
      {
        kind: 'insertNode',
        ref: 'ref-table',
        spec: {
          block: 'table',
          rows: [
            ['h1', 'h2'],
            ['c1', 'c2'],
          ],
        },
        at: { after: block(0) },
      },
    ],
  },
  {
    name: 'insertNode divider',
    markdown: 'Alpha\n\nBeta',
    ops: [
      {
        kind: 'insertNode',
        ref: 'ref-hr',
        spec: { block: 'divider' },
        at: { after: block(0) },
      },
    ],
  },
  {
    name: 'insertNode block equation is wrapped in a paragraph',
    markdown: 'Alpha',
    ops: [
      {
        kind: 'insertNode',
        ref: 'ref-eq',
        spec: { block: 'equation', tex: 'x^2' },
        at: { after: block(0) },
      },
    ],
  },
  {
    name: 'insertNode with an inline spec fails',
    markdown: 'Alpha',
    ops: [
      {
        kind: 'insertNode',
        ref: 'ref-bad',
        spec: { inline: 'linebreak' },
        at: { after: block(0) },
      },
    ],
  },
  {
    name: 'insertNode after an unknown node fails',
    markdown: 'Alpha',
    ops: [
      {
        kind: 'insertNode',
        ref: 'ref-orphan',
        spec: { block: 'paragraph', text: 'x' },
        at: { after: 'missing-id' },
      },
    ],
  },
  {
    name: 'a later op addresses the ref an earlier insertNode minted',
    markdown: 'Alpha',
    ops: [
      {
        kind: 'insertNode',
        ref: 'ref-chain',
        spec: { block: 'paragraph', text: 'First pass' },
        at: { after: block(0) },
      },
      { kind: 'setText', node: 'ref-chain', text: 'Second pass' },
    ],
  },
  {
    name: 'removeNode a paragraph',
    markdown: 'Alpha\n\nBeta\n\nGamma',
    ops: [{ kind: 'removeNode', node: block(1) }],
  },
  {
    name: 'removeNode a text node inside a block',
    markdown: 'plain **bold** tail',
    ops: [{ kind: 'removeNode', node: [0, 1] }],
  },
  {
    name: 'removeNode an unknown id fails',
    markdown: 'Alpha',
    ops: [{ kind: 'removeNode', node: 'missing-id' }],
  },
  {
    name: 'moveNode the last block to the front',
    markdown: 'Alpha\n\nBeta\n\nGamma',
    ops: [{ kind: 'moveNode', node: block(2), at: { before: block(0) } }],
  },
  {
    name: 'moveNode a block to the end of the root',
    markdown: 'Alpha\n\nBeta',
    ops: [{ kind: 'moveNode', node: block(0), at: { appendToRoot: true } }],
  },
  {
    name: 'mergeBlocks two paragraphs with a space',
    markdown: 'Alpha\n\nBeta',
    ops: [{ kind: 'mergeBlocks', nodes: [block(0), block(1)], separator: ' ' }],
  },
  {
    name: 'mergeBlocks three paragraphs keeping formats',
    markdown: 'one\n\n**two**\n\nthree',
    ops: [
      {
        kind: 'mergeBlocks',
        nodes: [block(0), block(1), block(2)],
        separator: ', ',
      },
    ],
  },
  {
    name: 'setBlockType paragraph to heading 3',
    markdown: 'Alpha',
    ops: [{ kind: 'setBlockType', node: block(0), block: 'heading', level: 3 }],
  },
  {
    name: 'setBlockType paragraph to quote',
    markdown: 'Alpha',
    ops: [{ kind: 'setBlockType', node: block(0), block: 'quote' }],
  },
  {
    name: 'setBlockType paragraph to code with a language',
    markdown: 'let x = 1;',
    ops: [
      { kind: 'setBlockType', node: block(0), block: 'code', language: 'ts' },
    ],
  },
  {
    name: 'setBlockType heading back to paragraph',
    markdown: '## Title',
    ops: [{ kind: 'setBlockType', node: block(0), block: 'paragraph' }],
  },
  {
    name: 'setBlockType on a list container fails',
    markdown: '- one',
    ops: [{ kind: 'setBlockType', node: block(0), block: 'quote' }],
  },
  {
    name: 'formatNode bold on a plain text node',
    markdown: 'plain',
    ops: [{ kind: 'formatNode', node: [0, 0], format: 'bold', on: true }],
  },
  {
    name: 'formatNode italic off when already off',
    markdown: 'plain',
    unchanged: true,
    ops: [{ kind: 'formatNode', node: [0, 0], format: 'italic', on: false }],
  },
  {
    name: 'formatNode on a block id fails',
    markdown: 'plain',
    ops: [{ kind: 'formatNode', node: block(0), format: 'bold', on: true }],
  },
  {
    name: 'clearNodeFormat on a bold italic run',
    markdown: 'a ***b*** c',
    ops: [{ kind: 'clearNodeFormat', node: [0, 1] }],
  },
  {
    name: 'setIndent in on a paragraph',
    markdown: 'Alpha',
    ops: [{ kind: 'setIndent', node: block(0), indent: 'in' }],
  },
  {
    name: 'setIndent to an absolute level',
    markdown: 'Alpha',
    ops: [{ kind: 'setIndent', node: block(0), indent: 2 }],
  },
  {
    name: 'setIndent out at zero',
    markdown: 'Alpha',
    ops: [{ kind: 'setIndent', node: block(0), indent: 'out' }],
  },
  {
    name: 'setIndent in on the second list item',
    markdown: '- one\n- two',
    ops: [{ kind: 'setIndent', node: [0, 1], indent: 'in' }],
  },
  {
    name: 'setIndent to an absolute level on a list item',
    markdown: '- one\n- two',
    ops: [{ kind: 'setIndent', node: [0, 1], indent: 2 }],
  },
  {
    name: 'a failing removeNode keeps the earlier insert and stops',
    markdown: 'Alpha',
    ops: [
      {
        kind: 'insertNode',
        ref: 'ref-kept',
        spec: { block: 'paragraph', text: 'kept' },
        at: { after: block(0) },
      },
      { kind: 'removeNode', node: 'missing-id' },
      { kind: 'removeNode', node: block(0) },
    ],
  },
  // List items override remove() (merging nested lists either side) and
  // insertAfter() (splitting the list); moves and removals go through them.
  // Nested items sit in their own list item after their parent: [0,1] and
  // [0,3] hold the a1 and b1 lists.
  {
    name: 'removeNode a list item between two nested lists',
    markdown: '- a\n  - a1\n- b\n  - b1\n- c',
    ops: [{ kind: 'removeNode', node: [0, 2] }],
  },
  {
    name: 'removeNode the only item of a list',
    markdown: '- only\n\nTail',
    ops: [{ kind: 'removeNode', node: [0, 0] }],
  },
  {
    name: 'moveNode a paragraph after a middle list item',
    markdown: 'Para\n\n- one\n- two\n- three',
    ops: [{ kind: 'moveNode', node: block(0), at: { after: [1, 1] } }],
  },
  {
    name: 'moveNode a list item after a root paragraph',
    markdown: 'Para\n\n- one\n- two',
    ops: [{ kind: 'moveNode', node: [1, 0], at: { after: block(0) } }],
  },
  {
    name: 'moveNode a list item to the end of the root',
    markdown: 'Para\n\n- one\n- two',
    ops: [{ kind: 'moveNode', node: [1, 0], at: { appendToRoot: true } }],
  },
  {
    name: 'moveNode a list item beside the nested list its removal merges away',
    markdown: '- a\n  - a1\n- b\n  - b1\n- c',
    ops: [{ kind: 'moveNode', node: [0, 2], at: { after: [0, 3] } }],
  },
  {
    name: 'moveNode a list item after an item of the merged nested list',
    markdown: '- a\n  - a1\n- b\n  - b1\n- c',
    ops: [{ kind: 'moveNode', node: [0, 2], at: { after: [0, 3, 0, 0] } }],
  },
  // Lexical ListItemNode.setIndent floors a fraction, throws on a negative and
  // loops one nesting level per step up to the target.
  {
    name: 'setIndent to a fractional level floors it',
    markdown: '- one\n- two',
    ops: [{ kind: 'setIndent', node: [0, 1], indent: 1.7 }],
  },
  {
    name: 'setIndent to a negative level fails',
    markdown: '- one\n- two',
    ops: [{ kind: 'setIndent', node: [0, 1], indent: -1 }],
  },
  {
    // 20 levels: deeper nesting exceeds serde_json's default recursion
    // limit (128) when the native tests parse the corpus.
    name: 'setIndent to level 20',
    markdown: '- one\n- two',
    ops: [{ kind: 'setIndent', node: [0, 1], indent: 20 }],
  },
  // A retyped block gets a versioned id, and the old id still resolves to it.
  {
    name: 'setBlockType then address the old id',
    markdown: 'Alpha',
    ops: [
      { kind: 'setBlockType', node: block(0), block: 'heading', level: 2 },
      { kind: 'appendText', node: block(0), text: ' more' },
    ],
  },
  {
    name: 'setBlockType twice through the old id',
    markdown: 'Alpha',
    ops: [
      { kind: 'setBlockType', node: block(0), block: 'heading', level: 2 },
      { kind: 'setBlockType', node: block(0), block: 'quote' },
    ],
  },
  // Placing at a list item: ListItemNode.insertAfter splits the list for a
  // non-item; there is no insertBefore override.
  {
    name: 'insertNode paragraph after a middle list item',
    markdown: '- one\n- two\n- three',
    ops: [
      {
        kind: 'insertNode',
        ref: 'ref-split',
        spec: { block: 'paragraph', text: 'Between' },
        at: { after: [0, 1] },
      },
    ],
  },
  {
    name: 'insertNode paragraph before a list item',
    markdown: '- one\n- two',
    ops: [
      {
        kind: 'insertNode',
        ref: 'ref-before-item',
        spec: { block: 'paragraph', text: 'Inside' },
        at: { before: [0, 1] },
      },
    ],
  },
  // Empty content: DocumentEditor.buildTable inserts empty cells first.
  {
    name: 'insertNode table with all-empty cells',
    markdown: 'Alpha',
    ops: [
      {
        kind: 'insertNode',
        ref: 'ref-empty-table',
        spec: {
          block: 'table',
          rows: [
            ['', ''],
            ['', ''],
          ],
        },
        at: { after: block(0) },
      },
    ],
  },
  {
    name: 'insertNode list with an empty item',
    markdown: 'Alpha',
    ops: [
      {
        kind: 'insertNode',
        ref: 'ref-empty-item',
        spec: { block: 'list', list: 'bullet', items: ['', 'two'] },
        at: { after: block(0) },
      },
    ],
  },
];

/** Durable id of a seed node by top-level index or child path. */
function addressId(
  session: ReturnType<typeof setup>['session'],
  address: Address
): string | undefined {
  const path = typeof address === 'number' ? [address] : address;
  const state = session.editor.getEditorState().toJSON();
  let node: { children?: unknown[]; $?: { id?: string } } | undefined =
    state.root as never;
  for (const index of path) node = node?.children?.[index] as never;
  return node?.$?.id;
}

/** Like `generate`, but refs stay verbatim and other minted ids are numbered
 *  `<new0>`, `<new1>`… in order of appearance (a bijection, not one bucket). */
export function generateBlocks(
  cases: readonly BlockCase[]
): BlockCorpusEntry[] {
  return cases.map((testCase) => {
    const { session } = setup(testCase.markdown);
    const seed = session.editor.getEditorState().toJSON();
    const refs: string[] = [];
    const resolve = (value: unknown): unknown => {
      if (typeof value === 'number' || Array.isArray(value)) {
        const id = addressId(session, value as Address);
        if (id === undefined)
          throw new Error(
            `${testCase.name}: no seed node at ${JSON.stringify(value)}`
          );
        return id;
      }
      return value;
    };
    const ops = testCase.ops.map((raw) => {
      const op = { ...(raw as Record<string, unknown>) };
      if ('node' in op) op.node = resolve(op.node);
      if (
        Array.isArray(op.nodes) &&
        op.nodes.every((n) => typeof n === 'number')
      )
        op.nodes = (op.nodes as number[]).map(resolve);
      if (op.at && typeof op.at === 'object') {
        const at = { ...(op.at as Record<string, unknown>) };
        if ('after' in at) at.after = resolve(at.after);
        if ('before' in at) at.before = resolve(at.before);
        op.at = at;
      }
      if (typeof op.ref === 'string') refs.push(op.ref);
      return op as DocumentOp;
    });
    const doc = new Doc(session);
    let failedAt: number | null = null;
    for (const [index, op] of ops.entries()) {
      try {
        doc.apply(op);
      } catch {
        failedAt = index;
        break;
      }
    }
    const names = new Map<string, string>();
    collectIds(seed, (id) => {
      if (!names.has(id))
        names.set(id, `s${String(names.size).padStart(7, '0')}`);
    });
    for (const ref of refs) names.set(ref, ref);
    let minted = 0;
    const rename = (id: string) => {
      let name = names.get(id);
      if (name === undefined) {
        name = `<new${minted++}>`;
        names.set(id, name);
      }
      return name;
    };
    const state = renameIds(
      session.editor.getEditorState().toJSON(),
      rename
    ) as SerializedEditorState;
    const renameOp = (op: DocumentOp) => {
      const out = { ...(op as Record<string, unknown>) };
      if (typeof out.node === 'string')
        out.node = names.get(out.node) ?? out.node;
      if (Array.isArray(out.nodes))
        out.nodes = out.nodes.map((n) => names.get(n as string) ?? n);
      if (out.at && typeof out.at === 'object') {
        const at = { ...(out.at as Record<string, unknown>) };
        for (const key of ['after', 'before'])
          if (typeof at[key] === 'string')
            at[key] = names.get(at[key] as string) ?? at[key];
        out.at = at;
      }
      return out as DocumentOp;
    };
    return {
      name: testCase.name,
      seed: renameIds(
        seed,
        (id) => names.get(id) ?? id
      ) as SerializedEditorState,
      ops: ops.map(renameOp),
      state,
      failedAt,
      refs,
    };
  });
}
