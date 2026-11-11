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
