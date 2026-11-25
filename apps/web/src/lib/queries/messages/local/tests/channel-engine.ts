import type {
  CacheRevision,
  ChannelChange,
  ChannelCommitArgs,
  ChannelCommitOutcome,
  ChannelTimelineCommitCacheResult,
} from '@graphql-cache/index';
import { CHANNEL_ID, devicePage } from './fixtures';

/** A stored record, as far as the rules below read it. */
interface EngineRecord {
  id: string;
  content?: string;
}

/**
 * One channel as the cache engine keeps it: a watermark, and records and
 * removals stamped with the sequence that wrote them. Content older than its
 * record, its removal or (for a record not held) the watermark is dropped.
 */
export function channelEngine(initial: string | null) {
  let watermark = initial === null ? null : BigInt(initial);
  const records = new Map<string, { record: EngineRecord; stamp: bigint }>();
  const removed = new Map<string, bigint>();
  const commits: ChannelCommitArgs[] = [];
  const listeners = new Set<(change: ChannelChange) => void>();
  let heads = 0;

  const push = (kind: ChannelChange['kind']) => {
    for (const listener of [...listeners])
      listener({ channelId: CHANNEL_ID, kind });
  };

  const takes = (id: string, stamp: bigint, lowers: boolean) => {
    const held = records.get(id);
    if (held) return stamp >= held.stamp;
    const floor = removed.get(id);
    if (floor !== undefined && stamp < floor) return false;
    return lowers || watermark === null || stamp >= watermark;
  };

  function outcomeOf(
    args: ChannelCommitArgs,
    seq: bigint
  ): ChannelCommitOutcome['outcome'] {
    if (args.reset) {
      records.clear();
      removed.clear();
      watermark = seq;
      return 'applied';
    }
    if (args.watermark?.kind === 'lower') {
      if (watermark === null || seq < watermark) watermark = seq;
      return 'applied';
    }
    if (args.watermark?.kind !== 'advance') return 'applied';
    if (watermark === null) return 'unheld';
    if (BigInt(args.watermark.from) > watermark) return 'gap';
    if (seq <= watermark) return 'stale';
    watermark = seq;
    return 'applied';
  }

  /** Stores an answer: its records and its commit, in one step. */
  function apply(
    args: ChannelCommitArgs,
    written: readonly EngineRecord[] = []
  ): ChannelCommitOutcome {
    commits.push(args);
    const seq = args.seq === undefined ? undefined : BigInt(args.seq);
    const before = watermark;
    const outcome = seq === undefined ? 'applied' : outcomeOf(args, seq);
    if (seq !== undefined && outcome !== 'unheld') {
      const lowers = args.reset || args.watermark?.kind === 'lower';
      const floor = watermark;
      // An absent record is judged by the watermark the answer found.
      if (!lowers) watermark = before;
      const stored = written.filter(({ id }) => takes(id, seq, !!lowers));
      watermark = floor;
      for (const record of stored) {
        removed.delete(record.id);
        records.set(record.id, { record, stamp: seq });
      }
      for (const id of args.removedIds ?? []) {
        if ((records.get(id)?.stamp ?? seq) > seq) continue;
        records.delete(id);
        removed.set(id, seq);
      }
    }
    if (outcome !== 'unheld') push(args.reset ? 'reset' : 'changed');
    return {
      channelId: args.channelId,
      seq: watermark?.toString() ?? null,
      outcome,
    };
  }

  const host = {
    async channelTimeline() {
      heads += 1;
      const seq = watermark?.toString() ?? null;
      return devicePage([], { covered: seq !== null, seq });
    },
    async channelTimelineCommit(
      args: ChannelCommitArgs
    ): Promise<ChannelTimelineCommitCacheResult> {
      return {
        kind: 'committed',
        revision: '1' as CacheRevision,
        changed: [],
        channel: apply(args),
      };
    },
    onChannelChanged(listener: (change: ChannelChange) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return {
    host,
    commits,
    apply,
    /** Pushes a change of the channel another tab made. */
    push,
    /** How often the device was asked for its watermark. */
    heads: () => heads,
    listeners: () => listeners.size,
    seq: () => watermark?.toString() ?? null,
    setSeq(seq: string | null) {
      watermark = seq === null ? null : BigInt(seq);
    },
    content: (id: string) => records.get(id)?.record.content,
    holds: (id: string) => records.has(id),
  };
}
