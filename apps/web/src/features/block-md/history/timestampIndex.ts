import { serializedEditorStateToMarkdown } from '@macro-inc/lexical-core';
import { Telemetry } from '@macro-inc/observability';
import type { HistorySession, HistoryVersionId } from '@service-sync/client';
import type { SerializedEditorState } from 'lexical';
import { type Change, LoroDoc, type OpId, type PeerID } from 'loro-crdt';

/** Checked-out states kept for scrubbing back over versions already seen. */
const STATE_CACHE_SIZE = 64;
/** Main-thread budget per slice of the unchanged-session pass. */
const FILTER_SLICE_MS = 12;

function frontiersOfPrefix(changes: readonly Change[], length: number): OpId[] {
  // Maintain a proper frontier antichain: when a change's deps cover a peer already
  // in the frontier, that peer is now in the causal past and must be pruned.
  const frontier = new Map<PeerID, number>();
  for (let i = 0; i < length; i++) {
    const { peer, counter, length: changeLength, deps } = changes[i];
    const endCounter = counter + changeLength - 1;
    for (const dep of deps) {
      const cur = frontier.get(dep.peer);
      if (cur !== undefined && cur <= dep.counter) frontier.delete(dep.peer);
    }
    if (endCounter > (frontier.get(peer) ?? -1)) frontier.set(peer, endCounter);
  }
  return [...frontier.entries()].map(([peer, counter]) => ({ peer, counter }));
}

/**
 * Reads past versions of `doc` by replaying its history forward into a
 * separate doc. `LoroDoc.checkout` is cheap forward but walks every op back to
 * the target when moving to an older version (seconds on a long-lived doc), and
 * the history doc always starts at the latest version. Replaying from empty
 * costs one forward pass, and moving forward from the last replayed version
 * costs only the changes in between.
 */
export function buildTimestampIndex(doc: LoroDoc) {
  // Timestamps are seconds; a change belongs to every target at or after it.
  const changes = [...doc.getAllChanges().values()]
    .flat()
    .sort((a, b) => a.timestamp - b.timestamp || a.counter - b.counter);

  // The number of changes at or before `targetMs`: the version key of a time.
  const prefixLengthAt = (targetMs: number) => {
    let low = 0;
    let high = changes.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (changes[mid].timestamp * 1000 <= targetMs) low = mid + 1;
      else high = mid;
    }
    return low;
  };

  const versionOf = (prefixLength: number) =>
    doc.frontiersToVV(frontiersOfPrefix(changes, prefixLength)).toJSON();

  // Moves `replay` forward to `prefixLength`, or rebuilds it when the target is
  // behind it. Returns the doc now at that version.
  const advance = (replay: LoroDoc, prefixLength: number) => {
    const target = versionOf(prefixLength);
    let current = replay.oplogVersion().toJSON();
    let next = replay;
    for (const [peer, counter] of current) {
      if (counter > (target.get(peer) ?? 0)) {
        next = new LoroDoc();
        current = new Map();
        break;
      }
    }
    const spans = [...target]
      .map(([peer, counter]) => {
        const from = current.get(peer) ?? 0;
        return { id: { peer, counter: from }, len: counter - from };
      })
      .filter((span) => span.len > 0);
    if (spans.length > 0) {
      next.import(doc.export({ mode: 'updates-in-range', spans }));
    }
    return { doc: next, rebuilt: next !== replay };
  };

  // Lexical state at a version, or null at a version too early to render.
  const stateOf = (replay: LoroDoc): SerializedEditorState | null => {
    const state = replay.toJSON();
    return state.root?.type ? state : null;
  };

  let scrubReplay = new LoroDoc();
  const states = new Map<number, SerializedEditorState | null>();

  const checkoutPrefix = (prefixLength: number) => {
    const cached = states.get(prefixLength);
    if (cached !== undefined) {
      // Refresh recency.
      states.delete(prefixLength);
      states.set(prefixLength, cached);
      return cached;
    }
    const span = Telemetry.span('doc.history.checkout');
    span.setAttr('history.change_count', changes.length);
    span.setAttr('history.prefix_length', prefixLength);
    const moved = advance(scrubReplay, prefixLength);
    scrubReplay = moved.doc;
    span.setAttr('history.replay_rebuilt', moved.rebuilt);
    const state = stateOf(scrubReplay);
    states.set(prefixLength, state);
    if (states.size > STATE_CACHE_SIZE) {
      const oldest = states.keys().next();
      if (!oldest.done) states.delete(oldest.value);
    }
    span.end();
    return state;
  };

  return {
    checkoutAt(targetMs: number): SerializedEditorState | null {
      const prefixLength = prefixLengthAt(targetMs);
      if (prefixLength === 0) return null;
      return checkoutPrefix(prefixLength);
    },

    /**
     * A standalone doc holding exactly the history up to `targetMs`, for
     * reading op history as of that time.
     */
    docAt(targetMs: number): LoroDoc | null {
      const prefixLength = prefixLengthAt(targetMs);
      if (prefixLength === 0) return null;
      return advance(new LoroDoc(), prefixLength).doc;
    },

    versionIdAt(targetMs: number): HistoryVersionId | null {
      const frontiers = frontiersOfPrefix(changes, prefixLengthAt(targetMs));
      if (frontiers.length === 0) return null;
      const f = frontiers[frontiers.length - 1];
      return { peer: String(f.peer), counter: f.counter };
    },

    /**
     * Sessions whose start and end versions render the same markdown, so they
     * would show as an empty change. One forward replay serves every session in
     * start order. A session whose replay changes text is visibly different
     * without rendering anything; only sessions that touched structure or
     * attributes alone are compared as markdown. Yields to the event loop
     * between slices, and stops early once `isStale` reports the result unused.
     */
    async findUnchangedSessions(
      sessions: readonly HistorySession[],
      isStale: () => boolean
    ): Promise<Set<HistorySession> | null> {
      const span = Telemetry.span('doc.history.filter_sessions');
      span.setAttr('history.session_count', sessions.length);
      span.setAttr('history.change_count', changes.length);
      const ordered = [...sessions].sort((a, b) => a.startMs - b.startMs);
      const unchanged = new Set<HistorySession>();
      let replay = new LoroDoc();
      let compared = 0;
      let sliceStart = performance.now();
      for (let i = 0; i < ordered.length; i++) {
        if (performance.now() - sliceStart > FILTER_SLICE_MS) {
          await new Promise((resolve) => setTimeout(resolve));
          if (isStale()) {
            span.setAttr('history.cancelled', true);
            span.end();
            return null;
          }
          sliceStart = performance.now();
        }
        const session = ordered[i];
        const before = prefixLengthAt(session.startMs - 1);
        const after = prefixLengthAt(session.endMs);
        // Can't compute both states (edge frontiers): keep rather than hide.
        if (before === 0) continue;
        replay = advance(replay, before).doc;
        // Overlapping sessions start before this one ends; replay this one on a
        // copy so the next start is still ahead.
        const nextStartsBeforeEnd =
          i + 1 < ordered.length &&
          prefixLengthAt(ordered[i + 1].startMs - 1) < after;
        const work = nextStartsBeforeEnd ? replay.fork() : replay;
        let changedText = false;
        const unsubscribe = work.subscribe((batch) => {
          changedText ||= batch.events.some(
            (event) => event.diff.type === 'text' && event.diff.diff.length > 0
          );
        });
        advance(work, after);
        unsubscribe();
        if (changedText) continue;
        compared++;
        const beforeState = stateOf(advance(new LoroDoc(), before).doc);
        const afterState = stateOf(work);
        if (!beforeState || !afterState) continue;
        // A state markdown can't render is kept rather than failing the pass.
        try {
          if (
            serializedEditorStateToMarkdown(beforeState) ===
            serializedEditorStateToMarkdown(afterState)
          ) {
            unchanged.add(session);
          }
        } catch (error) {
          span.event('history.markdown_failed', {
            'error.message':
              error instanceof Error ? error.message : String(error),
          });
        }
      }
      span.setAttr('history.markdown_compared_count', compared);
      span.setAttr('history.unchanged_count', unchanged.size);
      span.end();
      return unchanged;
    },
  };
}
