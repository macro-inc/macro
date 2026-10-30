import type { CacheHost, CacheReadArgs } from '../host/types';
import {
  type CacheRevision,
  parseCacheRevision,
  type QueryUpdate,
  type ReadResult,
} from '../protocol';
import { isQueryObject } from './live-query';
import { applyQueryPatches } from './query-patches';

/** Expected cancellation when teardown or a generation change drops the operation's cursor mid-read. */
export class QueryReadInvalidatedError extends Error {
  constructor() {
    super('query read was invalidated');
    this.name = 'QueryReadInvalidatedError';
  }
}

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
        if (states.get(key) !== state) throw new QueryReadInvalidatedError();
        const revision = !full
          ? parseCacheRevision(update.revision)
          : undefined;
        if (
          state.latest &&
          isOlderThanLatest(revision, state.accepted, state.latest)
        )
          return state.latest.result;
        assertRevisionNotBehindBase(revision);
        const data = resultData(update, fallback);
        assertPatchHasSnapshot(update);
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
        forgetSnapshotAfterFailure(state);
        throw error;
      }

      function forgetSnapshotAfterFailure(
        stateInput: NonNullable<typeof state>
      ) {
        if (states.get(key) === stateInput && sequence >= stateInput.accepted)
          stateInput.snapshot = undefined;
      }

      function assertRevisionNotBehindBase(
        revision: CacheRevision | undefined
      ) {
        if (
          base &&
          revision !== undefined &&
          BigInt(revision) < BigInt(base.revision)
        )
          throw new Error('query revision moved backwards');
      }

      function isOlderThanLatest(
        revision: CacheRevision | undefined,
        accepted: number,
        latest: NonNullable<State['latest']>
      ) {
        return revision !== undefined && latest.revision !== undefined
          ? BigInt(revision) < BigInt(latest.revision) ||
              (revision === latest.revision && sequence < accepted)
          : sequence < accepted;
      }

      function assertPatchHasSnapshot(update: QueryUpdate | undefined) {
        if (update?.kind === 'patch' && !base)
          throw new Error('query patch has no snapshot');
      }

      function resultData(
        update: QueryUpdate | undefined,
        fallback: ReadResult | undefined
      ) {
        return update?.kind === 'patch'
          ? base
            ? applyQueryPatches(base.data, update.patches)
            : undefined
          : update?.kind === 'hit'
            ? update.data
            : fallback?.kind === 'hit'
              ? fallback.data
              : undefined;
      }
    },
  };
}
