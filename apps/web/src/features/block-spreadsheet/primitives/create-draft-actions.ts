import { createSignal, onCleanup } from 'solid-js';

type DraftAction = 'share' | 'ask' | 'edit';

/** Save a local draft once, await durability, then hand it to sharing or chat. */
export function createDraftActions(options: {
  snapshot: () => Uint8Array | undefined;
  context: () => Record<string, string>;
  createDocument: () => Promise<string | undefined>;
  saveDocument: (id: string, snapshot: Uint8Array) => Promise<void>;
  openChat: (id: string, context: Record<string, string>) => Promise<boolean>;
  openDocument: (id: string, action: DraftAction) => void;
  onSaveFailure: (action: DraftAction) => void;
}) {
  const [pending, setPending] = createSignal<DraftAction>();
  let documentId: string | undefined;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  async function run(action: DraftAction) {
    if (pending() || disposed) return;
    const snapshot = options.snapshot();
    if (!snapshot) return;
    const context = options.context();
    setPending(action);
    try {
      // Reuse the document when saving fails or the acknowledgement is lost.
      documentId ??= await options.createDocument();
      if (!documentId) throw new Error('Could not create spreadsheet.');
      await options.saveDocument(documentId, snapshot);
    } catch {
      if (!disposed) {
        setPending(undefined);
        options.onSaveFailure(action);
      }
      return;
    }
    if (disposed) return;
    try {
      if (action === 'ask' && !(await options.openChat(documentId, context)))
        return;
      if (!disposed) options.openDocument(documentId, action);
    } finally {
      if (!disposed) setPending(undefined);
    }
  }

  return {
    pending,
    share: () => run('share'),
    ask: () => run('ask'),
    edit: () => run('edit'),
  };
}
