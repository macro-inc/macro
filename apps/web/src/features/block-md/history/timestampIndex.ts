import { Automerge, type AutomergeDoc, plain } from '@macro-inc/automerge';
import type { HistoryVersionId } from '@service-sync/client';
import type { SerializedEditorState } from 'lexical';

export function buildTimestampIndex(doc: AutomergeDoc) {
  // Native changes are topologically ordered. Include dependencies even when
  // a collaborator's wall clock is ahead of the selected timestamp.
  const changes = Automerge.getAllChanges(doc.value).map(
    Automerge.decodeChange
  );
  const byHash = new Map(changes.map((change) => [change.hash, change]));
  function headsAt(targetMs: number): string[] {
    const included = new Set<string>();
    const include = (hash: string) => {
      if (included.has(hash)) return;
      const change = byHash.get(hash);
      if (!change) return;
      change.deps.forEach(include);
      included.add(hash);
    };
    changes
      .filter((change) => change.time * 1000 <= targetMs)
      .forEach((change) => include(change.hash));
    const heads = new Set(included);
    for (const hash of included)
      byHash.get(hash)?.deps.forEach((dep) => heads.delete(dep));
    return [...heads].sort();
  }
  return {
    checkoutAt(targetMs: number): SerializedEditorState | null {
      const heads = headsAt(targetMs);
      if (!heads.length) return null;
      const state = plain(
        Automerge.view(doc.value, heads)
      ) as unknown as SerializedEditorState;
      return state.root?.type ? state : null;
    },
    versionIdAt(targetMs: number): HistoryVersionId | null {
      const heads = headsAt(targetMs);
      return heads.length ? heads : null;
    },
  };
}
