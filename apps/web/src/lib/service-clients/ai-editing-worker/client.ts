import type { DocumentOp } from '@ai-ops/editor';
import { toast } from '@core/component/Toast/Toast';
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
} as const;

export type AiEditResult = 'ok' | 'failed' | 'cancelled';

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
  onOps?: (ops: DocumentOp[]) => void;
}): Promise<AiEditResult> {
  const controller = new AbortController();
  editControllers.set(args.documentId, controller);
  syncActiveEditDocs();
  try {
    const token = await getDocumentPermissionToken(args.documentId);
    const res = await fetch(`${AI_EDITING_WORKER_HOST}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentToken: token,
        documentId: args.documentId,
        prompt: args.prompt,
        models: MODELS,
        interpret: false,
        propagate: args.onOps === undefined ? undefined : false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('ai edit request failed', res.status, body);
      return 'failed';
    }
    if (args.onOps) {
      const { ops } = (await res.json()) as { ops: DocumentOp[] };
      args.onOps(ops);
    }
    return 'ok';
  } catch (e) {
    if (controller.signal.aborted) return 'cancelled';
    console.error('ai edit request failed', e);
    return 'failed';
  } finally {
    if (editControllers.get(args.documentId) === controller) {
      editControllers.delete(args.documentId);
      syncActiveEditDocs();
    }
  }
}

/**
 * `requestAiEdit` wrapper that toasts `'AI edit failed'` on failure (a user
 * cancel stays silent). The caller supplies a `finally` callback for any
 * post-edit cleanup (e.g. clearing a loading signal).
 */
export function requestAiEditWithToast(
  args: { documentId: string; prompt: string },
  onSettled: () => void
): void {
  requestAiEdit(args)
    .then((result) => {
      if (result === 'failed') toast.failure('AI edit failed');
    })
    .finally(onSettled);
}
