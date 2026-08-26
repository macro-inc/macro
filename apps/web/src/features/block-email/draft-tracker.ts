import { createSignal } from 'solid-js';

/** An email draft surfaced by global experimental chrome. */
export type TrackedEmailDraft = {
  id: string;
  label: string;
  threadId?: string;
  linkId?: string;
};

const [trackedEmailDrafts, setTrackedEmailDrafts] = createSignal<
  readonly TrackedEmailDraft[]
>([]);
const draftDeleteHandlers = new Map<string, () => Promise<void>>();

/** Email drafts created or opened during the current app session. */
export { trackedEmailDrafts };

/** Adds a draft to the global shelf or refreshes its display label. */
export function trackEmailDraft(
  id: string,
  label: string,
  metadata: Pick<TrackedEmailDraft, 'threadId' | 'linkId'> = {}
) {
  setTrackedEmailDrafts((drafts) => {
    const existing = drafts.find((draft) => draft.id === id);
    const resolvedLabel =
      label === 'Draft email' && existing && existing.label !== 'Draft email'
        ? existing.label
        : label;
    const next = {
      id,
      label: resolvedLabel,
      threadId: metadata.threadId ?? existing?.threadId,
      linkId: metadata.linkId ?? existing?.linkId,
    };
    if (
      existing?.label === next.label &&
      existing.threadId === next.threadId &&
      existing.linkId === next.linkId
    ) {
      return drafts;
    }
    if (!existing) return [...drafts, next];
    return drafts.map((draft) => (draft.id === id ? next : draft));
  });
}

/** Registers the mounted composer as the authoritative deletion owner. */
export function registerEmailDraftDeleteHandler(
  id: string,
  handler: () => Promise<void>
) {
  draftDeleteHandlers.set(id, handler);
  return () => {
    if (draftDeleteHandlers.get(id) === handler) {
      draftDeleteHandlers.delete(id);
    }
  };
}

/** Deletes through the mounted composer when it owns this draft. */
export async function deleteEmailDraftThroughComposer(id: string) {
  const handler = draftDeleteHandlers.get(id);
  if (!handler) return false;
  await handler();
  return true;
}

/** Removes a draft after it is sent or explicitly deleted. */
export function untrackEmailDraft(id: string) {
  setTrackedEmailDrafts((drafts) =>
    drafts.filter((draft) => draft.id !== id)
  );
}
