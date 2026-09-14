import type { DocumentOp } from '@ai-ops/editor';
import { resumeDocumentSpan } from '@block-md/observability';
import { toast } from '@core/component/Toast/Toast';
import { Telemetry } from '@macro-inc/observability';
import { getDocumentPermissionToken } from '@service-storage/client';
import { createSignal } from 'solid-js';

// Full-URL override (scheme included) for pointing at a local wrangler dev
// worker, e.g. VITE_AI_EDITING_WORKER_URL=http://localhost:8788 bun run dev
const overrideUrl: string | undefined = import.meta.env
  .VITE_AI_EDITING_WORKER_URL;

const AI_EDITING_WORKER_HOST =
  overrideUrl?.replace(/\/$/, '') ??
  (import.meta.env.MODE === 'development'
    ? 'https://ai-editing-worker-dev.macroverse.workers.dev'
    : 'https://ai-editing-worker.macroverse.workers.dev');

/**
 * Model fallback chains per worker role. Mirrors the chains the backend
 * EditDocument tool sends (crates/documents editing_worker_client.rs).
 */
const MODELS = {
  supervisor: [
    { provider: 'anthropic', model: 'claude-opus-4-8' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    { provider: 'openai', model: 'gpt-5.5' },
  ],
  interpret: [
    { provider: 'cerebras', model: 'zai-glm-4.7' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  ],
  coding: [
    { provider: 'cerebras', model: 'gpt-oss-120b' },
    { provider: 'anthropic', model: 'claude-haiku-4-5' },
  ],
  // The fast path's single model: whole doc in, `runCode` out, no supervisor.
  // Mirrors the chain the backend EditDocument tool sends for `fast: true`.
  // Benched on a real inline request (10k-token prompt, one runCode step):
  // 3.8 Flash 1.5-5 s with no thinking tokens, 3.7 Flash 3.8-5.4 s (~450
  // thinking tokens even at `low`), 3.5 Flash Lite 0.8-1.1 s with identical
  // code on three requests. 3.8 leads for headroom on harder edits; Haiku is
  // the provider-error fallback.
  fast: [
    { provider: 'google', model: 'gemini-3.8-flash' },
    { provider: 'anthropic', model: 'claude-haiku-4-5' },
  ],
} as const;

/**
 * `supervised` runs the full interpreter → supervisor → coders pipeline.
 * `fast` gives one model the whole document and lets it edit directly; a few
 * seconds instead of tens, at the cost of the supervisor's review loop. Meant
 * for small, well-scoped inline edits.
 */
export type AiEditMode = 'supervised' | 'fast';

export type AiEditResult =
  | { kind: 'ok' }
  | { kind: 'failed' }
  | { kind: 'cancelled' }
  /** The worker stopped to ask for something only the user can supply. No
   *  edits were made; `message` says what to add to the request. */
  | { kind: 'blocked'; message: string };

// In-flight edits by document id. Aborting the fetch cancels the session
// server-side too: the worker threads the request signal into runEditSession
// (needs enable_request_signal, so only on deployed Cloudflare, not workerd).
const editControllers = new Map<string, AbortController>();
const [activeEditDocs, setActiveEditDocs] = createSignal<ReadonlySet<string>>(
  new Set()
);
const syncActiveEditDocs = () =>
  setActiveEditDocs(new Set(editControllers.keys()));

/** Reactive: whether an AI edit is in flight for this document. */
export function hasActiveAiEdit(documentId: string): boolean {
  return activeEditDocs().has(documentId);
}

/** Cancel the in-flight AI edit for this document, if any. */
export function cancelAiEdit(documentId: string): void {
  editControllers.get(documentId)?.abort();
}

/**
 * Run an AI edit session directly on the ai-editing-worker.
 *
 * The edit arrives via live sync; the worker only responds once the session
 * finishes, so the returned promise doubles as a completion signal. Cancelable
 * via `cancelAiEdit` (a later edit on the same document takes over the
 * registry slot). Failures are logged. Never rejects.
 *
 * Pass `onOps` to instead have the worker compute ops WITHOUT committing them
 * to the shared doc — the full op list is handed back once the session
 * finishes, and `onOps` applies them locally (via `applyAiOps`), so the edit
 * lands in the caller's own undo stack (Ctrl+Z) and syncs out attributed to
 * the user.
 */
export async function requestAiEdit(args: {
  documentId: string;
  prompt: string;
  /** Defaults to the worker's `supervised` pipeline. */
  mode?: AiEditMode;
  onOps?: (ops: DocumentOp[]) => void;
}): Promise<AiEditResult> {
  const controller = new AbortController();
  editControllers.set(args.documentId, controller);
  syncActiveEditDocs();
  // Parent under the document's long-lived span when one exists, so the
  // worker's whole edit trace joins the user's editing session; the injected
  // traceparent makes the worker's request span a child of this one.
  const documentSpan = resumeDocumentSpan(args.documentId);
  const span = documentSpan
    ? documentSpan.run(() => Telemetry.clientSpan('http POST /edit'))
    : Telemetry.clientSpan('http POST /edit');
  span.setAttr('http.method', 'POST');
  span.setAttr('http.url', `${AI_EDITING_WORKER_HOST}/edit`);
  span.setAttr('document.id', args.documentId);
  span.setAttr('edit.mode', args.mode ?? 'supervised');
  try {
    const token = await getDocumentPermissionToken(args.documentId);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    span.injectTraceHeaders(headers);
    const res = await fetch(`${AI_EDITING_WORKER_HOST}/edit`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        documentToken: token,
        documentId: args.documentId,
        prompt: args.prompt,
        models: MODELS,
        mode: args.mode,
        interpret: false,
        propagate: args.onOps === undefined ? undefined : false,
      }),
      signal: controller.signal,
    });
    span.setAttr('http.status_code', res.status);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('ai edit request failed', res.status, body);
      const message = `HTTP ${res.status} for POST /edit`;
      span.error({
        name: 'HttpError',
        message,
        stack: new Error(message).stack,
      });
      return { kind: 'failed' };
    }
    const { ops, clarification } = (await res.json()) as {
      ops: DocumentOp[];
      clarification?: string;
    };
    if (clarification !== undefined) {
      span.setAttr('edit.blocked', true);
      return { kind: 'blocked', message: clarification };
    }
    args.onOps?.(ops);
    return { kind: 'ok' };
  } catch (e) {
    if (controller.signal.aborted) {
      span.setAttr('http.aborted', true);
      return { kind: 'cancelled' };
    }
    console.error('ai edit request failed', e);
    span.error(e);
    return { kind: 'failed' };
  } finally {
    span.end();
    if (editControllers.get(args.documentId) === controller) {
      editControllers.delete(args.documentId);
      syncActiveEditDocs();
    }
  }
}

/** Toast for a result that did not apply the edit; a user cancel stays silent. */
export function toastAiEditResult(result: AiEditResult): void {
  if (result.kind === 'failed') toast.failure('AI edit failed');
  if (result.kind === 'blocked') toast.failure(result.message);
}

/**
 * `requestAiEdit` wrapper that toasts on failure or a request for more detail
 * (a user cancel stays silent). The caller supplies a `finally` callback for
 * any post-edit cleanup (e.g. clearing a loading signal).
 */
export function requestAiEditWithToast(
  args: { documentId: string; prompt: string },
  onSettled: () => void
): void {
  requestAiEdit(args).then(toastAiEditResult).finally(onSettled);
}
