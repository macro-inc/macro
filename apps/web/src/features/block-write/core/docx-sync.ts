import type { LoroDoc } from 'loro-crdt';
import type { DocxEngine } from './docx-engine';
import {
  type DocxChanges,
  diffDocxStates,
  hasChanges,
  readDocxState,
  writeDocxChanges,
} from './docx-loro';
import { assemblePackage, type DocxPackageState } from './docx-package';

/** What the sync controller needs from the editor that owns the session. */
export type DocxSyncHost = {
  /** The engine for the session currently on screen. */
  engine(): DocxEngine;
  /** Repaint after the session was changed outside the editor's own commands. */
  refresh(): void;
  /** Replace the session with a package and remount the editor. */
  rebuild(bytes: Uint8Array): void;
  /** True while a block holds typing the editor has not committed yet. */
  isBusy?(blockId: string): boolean;
};

export type RemoteOutcome = 'unchanged' | 'patched' | 'rebuilt';

/** More block operations than this remount instead of patching one by one. */
const MAX_PATCH_OPERATIONS = 64;

function applyChanges(
  state: DocxPackageState,
  changes: DocxChanges,
  order: readonly string[]
): DocxPackageState {
  const blocks = new Map(state.blocks);
  for (const [id, xml] of changes.upserts) blocks.set(id, xml);
  for (const id of changes.removed) blocks.delete(id);
  const parts = new Map(state.parts);
  for (const [name, value] of changes.parts) {
    if (value === null) parts.delete(name);
    else parts.set(name, value);
  }
  return { order: [...order], blocks, parts };
}

/** Indices of `sequence` that form a longest common subsequence with `target`. */
function stableIds(
  sequence: readonly string[],
  target: readonly string[]
): Set<string> {
  const position = new Map(target.map((id, index) => [id, index]));
  const ranks = sequence.map((id) => position.get(id) ?? -1);
  const tails: number[] = [];
  const previous = new Array<number>(ranks.length).fill(-1);
  ranks.forEach((rank, index) => {
    if (rank < 0) return;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (ranks[tails[mid]] < rank) low = mid + 1;
      else high = mid;
    }
    if (low > 0) previous[index] = tails[low - 1];
    tails[low] = index;
  });
  const stable = new Set<string>();
  let cursor = tails.length ? tails[tails.length - 1] : -1;
  while (cursor >= 0) {
    stable.add(sequence[cursor]);
    cursor = previous[cursor];
  }
  return stable;
}

/**
 * Keeps one live Docxodus session and one collaborative Loro document in step.
 *
 * Two baselines make the exchange echo-free: `session` is what the engine held
 * when the two last agreed, and `shared` is what the Loro document held. Local
 * publishing diffs the engine against `session`; remote application diffs Loro
 * against `shared`. Re-serialization differences between the two never show up
 * as edits on either side.
 */
export class DocxSyncController {
  private session: DocxPackageState;
  private shared: DocxPackageState;

  constructor(
    private readonly doc: LoroDoc,
    private readonly host: DocxSyncHost
  ) {
    this.session = host.engine().snapshot();
    this.shared = readDocxState(doc);
  }

  /** The collaborative document as last applied to the session. */
  get sharedState(): DocxPackageState {
    return this.shared;
  }

  /** Publish edits made in the session since the last exchange. */
  publishLocal(): boolean {
    const current = this.host.engine().snapshot();
    const changes = diffDocxStates(this.session, current);
    this.session = current;
    if (!hasChanges(changes)) return false;
    writeDocxChanges(this.doc, changes);
    this.shared = applyChanges(this.shared, changes, current.order);
    return true;
  }

  /** Bring the session up to date with the collaborative document. */
  applyRemote(): RemoteOutcome {
    // Never let a remote patch overwrite committed-but-unpublished edits.
    this.publishLocal();
    const next = readDocxState(this.doc);
    const changes = diffDocxStates(this.shared, next);
    if (!hasChanges(changes)) {
      this.shared = next;
      return 'unchanged';
    }
    const deferred = new Map<string, string>();
    if (changes.parts.size === 0 && this.patch(next, changes, deferred)) {
      this.host.refresh();
      this.session = this.host.engine().snapshot();
      const blocks = new Map(next.blocks);
      for (const [id, xml] of deferred) blocks.set(id, xml);
      this.shared = { ...next, blocks };
      return 'patched';
    }
    this.rebuild(next);
    return 'rebuilt';
  }

  /** Replace the session wholesale with the collaborative document. */
  rebuild(next: DocxPackageState = readDocxState(this.doc)) {
    this.host.rebuild(assemblePackage(next));
    this.session = this.host.engine().snapshot();
    this.shared = next;
  }

  /**
   * Translate block changes into raw engine operations. Returns false when the
   * session cannot be patched in place, leaving the caller to rebuild.
   * `deferred` collects blocks skipped because the user is typing in them,
   * mapped to the shared content they last agreed on.
   */
  private patch(
    next: DocxPackageState,
    changes: DocxChanges,
    deferred: Map<string, string>
  ): boolean {
    const engine = this.host.engine();
    const target = next.order;
    const removed = new Set(changes.removed);
    const sessionOrder = this.session.order.filter((id) => !removed.has(id));
    const inSession = new Set(sessionOrder);
    // Blocks the session has that the shared document neither has nor removed
    // mean the two diverged in a way a patch cannot reason about.
    const wanted = new Set(target);
    if (sessionOrder.some((id) => !wanted.has(id))) return false;

    const stable = stableIds(sessionOrder, target);
    const operations =
      changes.removed.length +
      target.filter((id) => !stable.has(id)).length +
      changes.upserts.size;
    if (operations > MAX_PATCH_OPERATIONS) return false;

    let anchors = engine.bodyAnchors();
    const anchorOf = (id: string): string | undefined => {
      const known = anchors.get(id);
      if (known) return known;
      anchors = engine.bodyAnchors();
      return anchors.get(id);
    };

    for (const id of changes.removed) {
      if (!this.session.blocks.has(id)) continue;
      const anchor = anchorOf(id);
      if (!anchor || !engine.deleteBlock(anchor)) return false;
    }

    const inserted = new Set<string>();
    const firstStable = target.find((id) => stable.has(id));
    let previous: string | null = null;
    for (const id of target) {
      if (!stable.has(id)) {
        const neighbour =
          previous ?? firstStable ?? sessionOrder.find((other) => other !== id);
        const position = previous ? 'after' : 'before';
        const neighbourAnchor = neighbour ? anchorOf(neighbour) : undefined;
        if (!neighbourAnchor) return false;
        if (inSession.has(id)) {
          const anchor = anchorOf(id);
          if (!anchor || !engine.moveBlock(anchor, neighbourAnchor, position))
            return false;
        } else {
          const xml = next.blocks.get(id);
          if (xml === undefined) return false;
          if (!engine.insertBlock(neighbourAnchor, position, xml)) return false;
          inserted.add(id);
          inSession.add(id);
        }
      }
      previous = id;
    }

    for (const [id, xml] of changes.upserts) {
      if (inserted.has(id)) continue;
      if (this.host.isBusy?.(id)) {
        const agreed = this.shared.blocks.get(id);
        if (agreed !== undefined) deferred.set(id, agreed);
        continue;
      }
      const anchor = anchorOf(id);
      if (!anchor || !engine.replaceBlock(anchor, xml)) return false;
    }
    return true;
  }
}
