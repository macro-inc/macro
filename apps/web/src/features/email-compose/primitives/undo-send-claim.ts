const claimedDraftIds = new Set<string>();

/** Claim an undo for this draft. Returns false if one is in flight or done. */
export function tryBeginUndoSend(draftId: string): boolean {
  if (claimedDraftIds.has(draftId)) return false;
  claimedDraftIds.add(draftId);
  return true;
}

/** Release a claim — after a failed undo, or when the draft is sent again. */
export function endUndoSend(draftId: string) {
  claimedDraftIds.delete(draftId);
}
