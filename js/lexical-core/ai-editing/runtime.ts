/**
 * The seam between the model and the editing system. The AI authors a JS snippet
 * whose ONLY in-scope value is `editor` (a `DocumentEditor`); running it fills an
 * op array (and may throw `EditError` immediately on a bad id). We then play the
 * ops through the queue — animating + applying each via the `Doc` and pumping
 * cursors through the `AwarenessSource` — and hand the model back a clean,
 * per-op summary instead of a diff.
 */
import { $getRoot, $isElementNode, type LexicalNode } from 'lexical';
import { $getId } from '../plugins/nodeIdPlugin';
import type { Session } from './ai-toolkit/session';
import type { AwarenessSource } from './awareness/awareness-source';
import type { Doc } from './doc/doc';
import { DocumentEditor } from './editor/document-editor';
import { EditError } from './editor/errors';
import type { DocumentOp } from './editor/ops';
import { DEFAULT_QUEUE_PARAMS, DocumentOpQueue, type DocumentOpQueueParams } from './queue/document-op-queue';
import { runQueue, summarize } from './queue/executor';
import { realRandomSource } from './queue/random-source';

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

/** Pluggable code runner: takes the valid id set + AI snippet, returns the ops. */
export type CodeRunner = (validIds: Set<string>, code: string) => DocumentOp[] | Promise<DocumentOp[]>;

/** Default runner: uses new Function (works in bun/node, requires unsafe_eval in Workers). */
export const defaultCodeRunner: CodeRunner = (validIds, code) => {
  const editor = new DocumentEditor({ validIds });
  // eslint-disable-next-line no-new-func
  new Function('editor', code)(editor);
  return editor.drain();
};

export type RunEditorCodeArgs = {
  session: Session;
  doc: Doc;
  code: string;
  awarenessSource: AwarenessSource;
  params?: DocumentOpQueueParams;
  sleep?: (ms: number) => Promise<void>;
  /** Override the default new Function runner (e.g. QuickJS sandbox for Workers). */
  runner?: CodeRunner;
  /** Called with the raw ops before they are queued/applied — use to collect them. */
  onOps?: (ops: DocumentOp[]) => void;
};

/**
 * Build → validate → drain → animate/apply, returning the model-facing summary.
 * An eager `EditError` (or any JS error) from the snippet is reported immediately
 * and nothing is applied.
 *
 * Awareness lifecycle is the CALLER's: the `awarenessSource` is constructed per
 * writer/turn by the caller, which clears it (cursors + keepAlive timer) when the
 * next turn starts — this run intentionally leaves the final cursor in place.
 */
export async function runEditorCode(args: RunEditorCodeArgs): Promise<string> {
  const runner = args.runner ?? defaultCodeRunner;
  let ops: DocumentOp[];
  try {
    ops = await runner(docIds(args.session), args.code);
  } catch (e) {
    return `error: ${e instanceof EditError ? e.message : (e as Error).message}`;
  }
  args.onOps?.(ops);
  if (ops.length === 0) return 'no operations';
  const queue = DocumentOpQueue.from(ops, args.params ?? DEFAULT_QUEUE_PARAMS);
  const results = await runQueue({
    queue,
    // Animation jitter is an internal presentation detail — not the model's to control.
    randomSource: realRandomSource(),
    docReader: args.doc,
    docWriter: args.doc,
    awarenessSource: args.awarenessSource,
    resolveNode: (n) => args.doc.resolveRef(n), // point cursors at inserted nodes
    sleep: args.sleep,
  });
  return summarize(results);
}
