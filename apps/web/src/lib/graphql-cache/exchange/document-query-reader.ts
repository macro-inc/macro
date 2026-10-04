import type { CacheHost, CacheReadArgs } from '../host/types';
import {
  type CacheRevision,
  parseCacheRevision,
  type ReadResult,
} from '../protocol';
import { isQueryObject } from './live-query';
import { applyQueryPatches } from './query-patches';

/** One cursor per active operation. Generation/disposal invalidates in-flight reads too. */
export function createDocumentQueryReader(
  host: Pick<CacheHost, 'readQuery' | 'watchQuery'>
) {
  type Snapshot = { revision: CacheRevision; data: Record<string, unknown> };
  type State = {
    signature: string;
    sequence: number;
    accepted: number;
    snapshot?: Snapshot;
    latest?: { revision?: CacheRevision; result: ReadResult };
  };
  const states = new Map<number, State>();

  return {
    forget: (key: number) => states.delete(key),
    clear: () => states.clear(),
    async read(args: CacheReadArgs): Promise<ReadResult> {
      if (args.opKey === undefined) return host.readQuery(args);
      const key = args.opKey;
      const signature = JSON.stringify([
        args.query,
        args.operationName,
        args.variables,
        args.entityResolvers,
      ]);
      let state = states.get(key);
      if (state?.signature !== signature) {
        state = { signature, sequence: 0, accepted: 0 };
        states.set(key, state);
      }
      const sequence = ++state.sequence;
      const base = state.snapshot;
      try {
        const update = await host.watchQuery?.({
          ...args,
          opKey: key,
          since: base?.revision,
        });
        const full = !update || update.kind === 'unsupported';
        const fallback = full ? await host.readQuery(args) : undefined;
        if (states.get(key) !== state)
          throw new Error('query read was invalidated');
        const revision = !full
          ? parseCacheRevision(update.revision)
          : undefined;
        if (
          state.latest &&
          (revision !== undefined && state.latest.revision !== undefined
            ? BigInt(revision) < BigInt(state.latest.revision) ||
              (revision === state.latest.revision && sequence < state.accepted)
            : sequence < state.accepted)
        )
          return state.latest.result;
        if (
          base &&
          revision !== undefined &&
          BigInt(revision) < BigInt(base.revision)
        )
          throw new Error('query revision moved backwards');
        const data =
          update?.kind === 'patch'
            ? base
              ? applyQueryPatches(base.data, update.patches)
              : undefined
            : update?.kind === 'hit'
              ? update.data
              : fallback?.kind === 'hit'
                ? fallback.data
                : undefined;
        if (update?.kind === 'patch' && !base)
          throw new Error('query patch has no snapshot');
        const result: ReadResult =
          update?.kind === 'miss' || fallback?.kind === 'miss'
            ? { kind: 'miss' }
            : { kind: 'hit', data };
        state.accepted = Math.max(sequence, state.accepted);
        state.snapshot =
          revision !== undefined && isQueryObject(data)
            ? { data, revision }
            : undefined;
        state.latest = { revision, result };
        return result;
      } catch (error) {
        if (states.get(key) === state && sequence >= state.accepted)
          state.snapshot = undefined;
        throw error;
      }
    },
  };
}
