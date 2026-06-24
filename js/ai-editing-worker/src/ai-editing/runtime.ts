import { $getRoot, $isElementNode, type LexicalNode } from 'lexical';
import { $getId } from '../../../lexical-core/plugins/nodeIdPlugin';
import type { Session } from './ai-toolkit/session';
import type { AwarenessSource } from './awareness/awareness-source';
import type { Doc } from './doc/doc';
import type { DocumentOp } from './editor/ops';
import { realRandomSource } from './queue/random-source';
import { applyOp, type OpResult, runQueue } from './queue/runner';
import type { DocumentOpQueueParams } from './queue/types';

/** Every durable id currently in the document (what the model is allowed to reference). */
export function docIds(session: Session): Set<string> {
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

export type RunEditorCodeArgs = {
  session: Session;
  doc: Doc;
  code: string;
  awarenessSource: AwarenessSource;
  runner: CodeRunner;
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
        applyOp(args.doc, op);
        return { ok: true, op };
      } catch (e) {
        if (!(e instanceof Error)) throw new Error(String(e));
        return { ok: false, op, error: e.message };
      }
    });
    return summarizeErrorsOnly(results);
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
  return summarizeErrorsOnly(results);
}

/**
 * Give the model a brief summary of errors that occured.
 */
function summarizeErrorsOnly(results: OpResult[]): string {
  const failures = results.filter(
    (r): r is Extract<OpResult, { ok: false }> => !r.ok
  );
  if (failures.length === 0) return 'ok';
  return failures.map((r) => `error: ${r.op.kind}: ${r.error}`).join('\n');
}
