import { $getId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { $getRoot, $isElementNode, type LexicalNode } from 'lexical';
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

/** Keys the generated code references as `snippets.KEY` / `snippets["KEY"]`. */
export function snippetKeysIn(code: string): string[] {
  const keys = new Set<string>();
  for (const match of code.matchAll(
    /\bsnippets\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*["']([^"']+)["']\s*\])/g
  )) {
    keys.add((match[1] ?? match[2])!);
  }
  return [...keys];
}

export type RunEditorCodeArgs = {
  session: LexicalSession;
  doc: Doc;
  code: string;
  awarenessSource: AwarenessSource;
  runner: CodeRunner;
  /** Content the writer composed for this call, passed alongside its code and
   *  referenced there as `snippets.KEY`. */
  snippets?: Record<string, string>;
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
    // Every key the code references must come with the call — catch a missing
    // one here with a pointed message instead of an undefined leaking into ops.
    const missing = snippetKeysIn(args.code).filter(
      (key) => args.snippets?.[key] === undefined
    );
    if (missing.length > 0) {
      const list = missing.map((k) => `"${k}"`).join(', ');
      throw new Error(
        `snippet${missing.length > 1 ? 's' : ''} ${list} ${missing.length > 1 ? 'are' : 'is'} not defined -- pass their text in the \`snippets\` argument of this runCode call`
      );
    }
    ops = await args.runner(docIds(args.session), args.code, args.snippets);
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
