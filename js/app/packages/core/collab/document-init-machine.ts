import { match } from 'ts-pattern';

/**
 * State machine for cold-load doc initialization. Coordinates which
 * snapshot source seeds the doc and rejects sources that would corrupt it.
 *
 *   - clean mode (wasDirty=false): higher-authority snapshots win.
 *     Once we've taken dss, we're synced.
 *   - dirty mode (wasDirty=true): only the local snapshot + the resulting
 *     `requestUpdatesSince` delta are accepted. Shallow snapshots from the
 *     server are unsafe on top of dirty local state, we need a proper updates
 *     result.
 */

export type SnapshotKind = 'optimistic' | 'local' | 's3' | 'dss' | 'requested'; // op-delta from requestUpdatesSince

export type Instruction = 'apply' | 'applyThenRequestDelta' | 'ignore';

/**
 * Authority rank for the cold-start snapshot cascade.
 * Higher = closer to server truth.
 */
const SNAPSHOT_AUTHORITY = {
  optimistic: 1,
  local: 1,
  s3: 2,
  dss: 3,
  requested: 0,
} as const satisfies Record<SnapshotKind, number>;

/** Phase is the machine's internal state. The discriminated union prevents
 *  e.g. dirty-mode states from showing up in clean-mode reasoning. */
type CleanPhase = { mode: 'clean'; appliedRank: 0 | 1 | 2 | 3 };
type DirtyPhase = {
  mode: 'dirty';
  phase: 'awaiting' | 'awaitingDelta' | 'synced';
};
export type Phase = CleanPhase | DirtyPhase;

type Transition = { instruction: Instruction; next: Phase };

export class DocInitMachine {
  private phase: Phase;

  private constructor(wasDirty: boolean) {
    this.phase = wasDirty
      ? { mode: 'dirty', phase: 'awaiting' }
      : { mode: 'clean', appliedRank: 0 };
  }

  /** Pass `wasDirty: true` when the WAL has undelivered entries
   *
   *  The machine then refuses every shallow snapshot and only accepts the
   *  local snapshot (which triggers `requestUpdatesSince`) followed by
   *  the resulting op delta.
   */
  public static create(wasDirty: boolean): DocInitMachine {
    return new DocInitMachine(wasDirty);
  }

  /** Feed the machine a snapshot of a given kind. Returns what the caller
   *  should do with the bytes. */
  public receive(kind: SnapshotKind): Instruction {
    const { instruction, next } =
      this.phase.mode === 'clean'
        ? stepClean(this.phase, kind)
        : stepDirty(this.phase, kind);
    this.phase = next;
    return instruction;
  }

  public currentPhase(): Phase {
    return this.phase;
  }
}

function stepClean(phase: CleanPhase, kind: SnapshotKind): Transition {
  const rank = SNAPSHOT_AUTHORITY[kind];
  // rank=0 means "kind doesn't apply in clean mode" (just `requested`).
  // rank <= appliedRank means we've already taken something at least as
  // authoritative — applying again would be a no-op or a regression.
  if (rank === 0 || rank <= phase.appliedRank) {
    return { instruction: 'ignore', next: phase };
  }
  return {
    instruction: 'apply',
    next: { mode: 'clean', appliedRank: rank as 1 | 2 | 3 },
  };
}

function stepDirty(phase: DirtyPhase, kind: SnapshotKind): Transition {
  return match<[DirtyPhase['phase'], SnapshotKind], Transition>([
    phase.phase,
    kind,
  ])
    .with(['awaiting', 'local'], () => ({
      instruction: 'applyThenRequestDelta',
      next: { mode: 'dirty', phase: 'awaitingDelta' },
    }))
    .with(['awaitingDelta', 'requested'], () => ({
      instruction: 'apply',
      next: { mode: 'dirty', phase: 'synced' },
    }))
    .otherwise(() => ({ instruction: 'ignore', next: phase }));
}
