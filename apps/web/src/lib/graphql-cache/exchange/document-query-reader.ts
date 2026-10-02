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
  };
  const states = new Map<number, State>();

  return {
    forget: (key: number) => states.delete(key),
    clear: () => states.clear(),
    async read(args: CacheReadArgs): Promise<ReadResult> {
      if (!host.watchQuery || args.opKey === undefined)
        return host.readQuery(args);
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
        const result = await host.watchQuery({
          ...args,
          opKey: key,
          since: base?.revision,
        });
        if (result.kind === 'unsupported') return host.readQuery(args);
        const revision = parseCacheRevision(result.revision);
        if (base && BigInt(revision) < BigInt(base.revision))
          throw new Error('query revision moved backwards');
        const data =
          result.kind === 'patch'
            ? base
              ? applyQueryPatches(base.data, result.patches)
              : undefined
            : result.kind === 'hit'
              ? result.data
              : undefined;
        if (result.kind === 'patch' && !base)
          throw new Error('query patch has no snapshot');
        if (states.get(key) === state && sequence >= state.accepted) {
          state.accepted = sequence;
          state.snapshot = isQueryObject(data) ? { data, revision } : undefined;
        }
        return result.kind === 'miss'
          ? { kind: 'miss' }
          : { kind: 'hit', data };
      } catch (error) {
        if (states.get(key) === state && sequence >= state.accepted)
          state.snapshot = undefined;
        throw error;
      }
    },
  };
}
