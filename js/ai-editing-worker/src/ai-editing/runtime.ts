import { $getRoot, $isElementNode, type LexicalNode } from 'lexical';
import { $getId } from '../../../lexical-core/plugins/nodeIdPlugin';
import type { LexicalSession } from './ai-toolkit/session';
import type { AwarenessSource } from './awareness';
import type { Doc } from './doc';
import type { DocumentOp } from './editor';
import {
  type DocumentOpQueueParams,
  type OpResult,
  realRandomSource,
  runQueue,
  summarize,
} from './queue';

/** Every durable id currently in the document (what the model is allowed to reference). */
export function docIds(session: LexicalSession): Set<string> {
  return session.editor.getEditorState().read(() => {
    const ids = new Set<string>();
    const walk = (node: LexicalNode) => {
      const id = $getId(node);
      if (id) ids.add(id);
      if ($isElementNode(node)) for (const c of node.getChildren()) walk(c);
    };
    for (const c of $getRoot().getChildren()) walk(c);
    return ids;
  });
}

/** Takes the valid id set + AI snippet, returns the ops. */
export type CodeRunner = (
  validIds: Set<string>,
  code: string,
  snippets?: Record<string, string>
) => DocumentOp[] | Promise<DocumentOp[]>;

/** How much a snippet writer invests in a composed snippet: `low` uses the
 *  fast default model, `high` routes to the stronger composition model. */
export type PendingSnippetEffort = 'low' | 'high';

/** A snippet still being composed by a snippet agent: `brief` describes it to
 *  the coder's prompt; `promise` resolves to the final text. */
export type PendingSnippet = { brief: string; promise: Promise<string> };

/** A static snippet is already-available text. */
export type StaticSnippet = string;

/** Snippet values as the coder sees them: verbatim strings plus pending ones.
 *  Settled into plain strings before any code runs — promises never cross the
 *  `CodeRunner` boundary. */
export type SnippetSource = Record<string, StaticSnippet | PendingSnippet>;

export function isStaticSnippet(
  value: StaticSnippet | PendingSnippet
): value is StaticSnippet {
  return typeof value === 'string';
}

export function isPendingSnippet(
  value: StaticSnippet | PendingSnippet
): value is PendingSnippet {
  return !isStaticSnippet(value);
}

/** Await every pending snippet, naming the key in any failure. */
export async function settleSnippets(
  source?: SnippetSource
): Promise<Record<string, StaticSnippet> | undefined> {
  if (!source) return undefined;
  const entries = await Promise.all(
    Object.entries(source).map(async ([key, value]) => {
      if (isStaticSnippet(value)) return [key, value] as const;
      try {
        return [key, await value.promise] as const;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        throw new Error(`snippet "${key}" failed: ${message}`);
      }
    })
  );
  return Object.fromEntries(entries);
}

export type RunEditorCodeArgs = {
  session: LexicalSession;
  doc: Doc;
  code: string;
  awarenessSource: AwarenessSource;
  runner: CodeRunner;
  snippets?: SnippetSource;
  params?: DocumentOpQueueParams;
  sleep?: (ms: number) => Promise<void>;
  /** Skip animation entirely -- apply each op directly with no typing, pauses, or cursor movement. */
  typingAnimations?: boolean;
  /** Called with the raw ops before they are queued/applied -- use to collect them. */
  onOps?: (ops: DocumentOp[]) => void;
};

/**
 * Build -> validate -> drain -> animate/apply, returning compact model-facing output.
 * An eager `EditError` (or any JS error) from the snippet is reported immediately
 * and nothing is applied.
 */
export async function runEditorCode(args: RunEditorCodeArgs): Promise<string> {
  let ops: DocumentOp[];
  try {
    const snippets = await settleSnippets(args.snippets);
    ops = await args.runner(docIds(args.session), args.code, snippets);
  } catch (e) {
    if (!(e instanceof Error)) throw new Error(String(e));
    return `error: ${e.message}`;
  }
  args.onOps?.(ops);
  if (ops.length === 0) return 'ok';

  if (args.typingAnimations === false) {
    const results: OpResult[] = ops.map((op) => {
      try {
        args.doc.apply(op);
        return { ok: true, op };
      } catch (e) {
        if (!(e instanceof Error)) throw new Error(String(e));
        return { ok: false, op, error: e.message };
      }
    });
    return summarize(results);
  }

  const results = await runQueue({
    ops,
    params: args.params,
    randomSource: realRandomSource(),
    docReader: args.doc,
    docWriter: args.doc,
    awarenessSource: args.awarenessSource,
    resolveNode: (n) => args.doc.resolveRef(n), // point cursors at inserted nodes
    sleep: args.sleep,
  });
  return summarize(results);
}
