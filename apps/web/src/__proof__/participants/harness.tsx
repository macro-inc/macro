// In-page differential harness for the channel participants reader. The driver
// (driver/run.ts) imports this into a signed-in app page served by Vite, so
// both sides use the app's own QueryClient, GraphQL client, persisted cache,
// websocket and session:
//   old: main's REST reader and hand-patched mutations, copied verbatim in main/;
//   new: the head's reader (main's query and mutations; its queryFn reads
//        GraphQL by id, REST for a channel the soup leaves out). main/keys.ts
//        gives the old side a key prefix of its own (check-copies.sh).
// Never shipped: nothing imports this module; the driver loads it by URL.

import { createInvitedSource as newInvitedSource } from '@app/features/block-form/queries/form-sources';
import { UserContextProvider } from '@core/context/user';
import {
  invalidateChannelParticipants as newInvalidate,
  useChannelParticipantsQuery as useNewReader,
} from '@queries/channel/channel-participants';
import { channelKeys } from '@queries/channel/keys';
import {
  useAddParticipantsMutation as useNewAdd,
  useRemoveParticipantsMutation as useNewRemove,
} from '@queries/channel/participants';
import { queryClient } from '@queries/client';
import { permanentlyDeleteEntity } from '@queries/storage/entity-mutations';
import { storageServiceClient } from '@service-storage/client';
import { QueryClientContext } from '@tanstack/solid-query';
import { err, ResultAsync } from 'neverthrow';
import { render } from 'solid-js/web';
import {
  type ChannelType,
  formReach,
  project,
  type ReaderState,
  type Row,
} from './contract';
import {
  invalidateChannelParticipants as oldInvalidate,
  useChannelParticipantsQuery as useOldReader,
} from './main/channel-participants';
import { createInvitedSource as oldInvitedSource } from './main/create-invited-source';
import { channelKeys as oldKeys } from './main/keys';
import {
  useAddParticipantsMutation as useOldAdd,
  useRemoveParticipantsMutation as useOldRemove,
} from './main/participants';

type Mutant =
  | 'none'
  | 'drop-row'
  | 'swap-order'
  | 'alter-field'
  | 'stale-cache'
  | 'skip-live';

type ReaderLike = {
  isPending: boolean;
  isLoading: boolean;
  isSuccess: boolean;
  data: readonly Row[] | undefined;
};

type MutateLike = {
  mutate: (vars: { channelId: string; participants: string[] }) => void;
};

type Mounted = {
  type: ChannelType;
  old: ReaderLike;
  neu: ReaderLike;
  oldAdd: MutateLike;
  oldRemove: MutateLike;
  newAdd: MutateLike;
  newRemove: MutateLike;
  /** skip-live and stale-cache: the value the mutant freezes. */
  frozen?: Row[];
  dispose: () => void;
};

type Gate = {
  calls: number;
  promise: Promise<unknown>;
  release: () => void;
};

const mounted = new Map<string, Mounted>();
const gates = new Map<string, Gate>();
let me = '';
let mutant: Mutant = 'none';

/** Rows exactly as the reader returned them, keys sorted. */
function rawRows(rows: readonly Row[] | undefined): Row[] | undefined {
  if (!rows) return undefined;
  return rows.map(
    (row) =>
      Object.fromEntries(
        Object.keys(row)
          .sort()
          .map((key) => [key, (row as Record<string, unknown>)[key]])
      ) as Row
  );
}

function readState(reader: ReaderLike): ReaderState {
  return {
    isPending: reader.isPending,
    isLoading: reader.isLoading,
    isSuccess: reader.isSuccess,
    data: rawRows(reader.data),
  };
}

const STALE_KEY = (channelId: string) => `px-stale:${me}:${channelId}`;

function storageGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

/** Plants a defect in the new side's output, to show the comparator catches it. */
function mutate(entry: Mounted, channelId: string, state: ReaderState) {
  const data = state.data;
  if (mutant === 'skip-live' || mutant === 'stale-cache') {
    if (!state.isPending && data && !entry.frozen) entry.frozen = data;
    if (mutant === 'stale-cache' && data)
      storageSet(STALE_KEY(channelId), JSON.stringify(data));
    return entry.frozen ? { ...state, data: entry.frozen } : state;
  }
  if (!data) return state;
  if (mutant === 'drop-row' && data.length > 0)
    return { ...state, data: data.slice(0, -1) };
  if (mutant === 'swap-order') {
    // Swap the first row with the first that joined at another time: rows that
    // joined together have no defined order on either side, so swapping two of
    // them is not a defect.
    const other = data.findIndex(
      (row) => Date.parse(row.joined_at) !== Date.parse(data[0]!.joined_at)
    );
    if (other > 0) {
      const swapped = [...data];
      [swapped[0], swapped[other]] = [swapped[other]!, swapped[0]!];
      return { ...state, data: swapped };
    }
  }
  if (mutant === 'alter-field' && data.length > 0) {
    const [first, ...rest] = data;
    const role = first!.role === 'owner' ? 'member' : 'owner';
    return { ...state, data: [{ ...first!, role }, ...rest] };
  }
  return state;
}

function snapshotOne(channelId: string) {
  const entry = mounted.get(channelId);
  if (!entry) return undefined;
  const old = readState(entry.old);
  const neu = mutate(entry, channelId, readState(entry.neu));
  return {
    at: Date.now(),
    old,
    new: neu,
    oldContract: project(old, me, entry.type),
    newContract: project(neu, me, entry.type),
  };
}

function ChannelReaders(props: {
  channelId: string;
  type: ChannelType;
  onReady: (entry: Omit<Mounted, 'dispose' | 'type'>) => void;
}) {
  // Mounted as the Participants tab mounts them: a reader and its mutations.
  props.onReady({
    old: useOldReader(() => props.channelId),
    neu: useNewReader(() => props.channelId),
    oldAdd: useOldAdd(),
    oldRemove: useOldRemove(),
    newAdd: useNewAdd(),
    newRemove: useNewRemove(),
  });
  return null;
}

function mount(channelId: string, type: ChannelType) {
  unmount(channelId);
  const host = document.createElement('div');
  let parts: Omit<Mounted, 'dispose' | 'type'> | undefined;
  const dispose = render(
    () => (
      <QueryClientContext.Provider value={() => queryClient}>
        <ChannelReaders
          channelId={channelId}
          type={type}
          onReady={(value) => {
            parts = value;
          }}
        />
      </QueryClientContext.Provider>
    ),
    host
  );
  const entry: Mounted = { ...parts!, type, dispose };
  if (mutant === 'stale-cache') {
    const stored = storageGet(STALE_KEY(channelId));
    if (stored) entry.frozen = JSON.parse(stored) as Row[];
  }
  mounted.set(channelId, entry);
}

function unmount(channelId: string) {
  mounted.get(channelId)?.dispose();
  mounted.delete(channelId);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until every reader of these channels has settled, both sides. */
async function settle(channelIds: string[], timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const pending = channelIds.filter((id) => {
      const entry = mounted.get(id);
      return !entry || entry.old.isPending || entry.neu.isPending;
    });
    if (!pending.length || Date.now() > until) return pending;
    await sleep(50);
  }
}

// One network write serves both sides: each side's mutation calls the storage
// client, and a gate keyed by method and arguments hands both the same promise.
// The gate can hold the request (to read the pending state) or fail it.
const GATED = [
  'addParticipantsToChannel',
  'removeParticipantsFromChannel',
] as const;
type GatedMethod = (typeof GATED)[number];
const client = storageServiceClient as unknown as Record<
  GatedMethod,
  (args: unknown) => Promise<unknown>
>;
const real = Object.fromEntries(
  GATED.map((name) => [name, client[name].bind(storageServiceClient)])
) as Record<GatedMethod, (args: unknown) => Promise<unknown>>;
for (const name of GATED) {
  client[name] = (args: unknown) => {
    const gate = gates.get(`${name} ${JSON.stringify(args)}`);
    if (!gate) return real[name](args);
    gate.calls += 1;
    return gate.promise;
  };
}

function injectedFailure() {
  return err([
    Object.assign(new Error('injected failure'), {
      code: 'INTERNAL_SERVER_ERROR',
    }),
  ]);
}

type Act = {
  kind: 'add' | 'remove';
  channelId: string;
  userIds: string[];
  fail?: boolean;
};

const acts = new Map<
  string,
  { gate: Gate; key: string; done: Promise<unknown> }
>();

/** Starts an add or remove through both sides' mutations, held at the network. */
function startAct(id: string, act: Act) {
  const entry = mounted.get(act.channelId);
  if (!entry) throw new Error(`channel ${act.channelId} is not mounted`);
  const name: GatedMethod =
    act.kind === 'add'
      ? 'addParticipantsToChannel'
      : 'removeParticipantsFromChannel';
  const args = { channel_id: act.channelId, participants: act.userIds };
  const key = `${name} ${JSON.stringify(args)}`;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const gate: Gate = {
    calls: 0,
    release,
    promise: (async () => {
      await held;
      return act.fail ? injectedFailure() : await real[name](args);
    })(),
  };
  gates.set(key, gate);
  const vars = { channelId: act.channelId, participants: act.userIds };
  const [oldMutation, newMutation] =
    act.kind === 'add'
      ? [entry.oldAdd, entry.newAdd]
      : [entry.oldRemove, entry.newRemove];
  oldMutation.mutate(vars);
  newMutation.mutate(vars);
  acts.set(id, { gate, key, done: gate.promise });
}

/** Lets held writes go and waits for their results and both sides' settling. */
async function releaseActs(ids: string[]) {
  const results: Record<
    string,
    { calls: number; ok: boolean; error?: string }
  > = {};
  for (const id of ids) acts.get(id)?.gate.release();
  for (const id of ids) {
    const act = acts.get(id);
    if (!act) continue;
    const result = (await act.done) as {
      isOk?: () => boolean;
      error?: unknown;
    };
    const ok = result?.isOk?.() ?? false;
    results[id] = {
      calls: act.gate.calls,
      ok,
      error: ok
        ? undefined
        : String(JSON.stringify(result?.error)).slice(0, 200),
    };
    gates.delete(act.key);
    acts.delete(id);
  }
  // Mutation callbacks (rollback, soft invalidation) run after the promise.
  await sleep(100);
  return results;
}

type Write =
  | { kind: 'join' | 'leave' | 'request'; channelId: string }
  | { kind: 'approve'; channelId: string; requestId: string }
  | { kind: 'autojoin'; channelId: string; on: boolean }
  | { kind: 'bot-add' | 'bot-remove'; channelId: string; botId: string }
  | { kind: 'delete'; channelId: string };

/**
 * A write outside the participants mutations: one network call, then what each
 * version's caller does to the roster cache afterwards.
 *   approve:   access-requests.ts:135 invalidate, on main and the head.
 *   autojoin:  channels.ts:257 invalidate, on main and the head.
 *   bot-*:     channel-bots.ts:72-75 invalidate, on main and the head.
 *   join, leave, request, delete: neither touches the roster cache.
 */
async function write(op: Write) {
  const c = storageServiceClient;
  const result = await (async () => {
    switch (op.kind) {
      case 'join':
        return await c.joinChannel({ channel_id: op.channelId });
      case 'leave':
        return await c.leaveChannel({ channel_id: op.channelId });
      case 'request':
        return await c.requestChannelAccess({ channel_id: op.channelId });
      case 'approve':
        return await c.resolveChannelAccessRequest({
          channel_id: op.channelId,
          request_id: op.requestId,
          decision: 'approve',
        });
      case 'autojoin':
        return await c.patchChannel({
          channel_id: op.channelId,
          auto_join_team: op.on,
        });
      case 'bot-add':
        return await c.addBotToChannel({
          channel_id: op.channelId,
          bot_id: op.botId,
        });
      case 'bot-remove':
        return await c.removeBotFromChannel({
          channel_id: op.channelId,
          bot_id: op.botId,
        });
      case 'delete':
        // features/entity/queries/dss.ts:181 then :56, the same on main and the head.
        return await ResultAsync.fromPromise(
          permanentlyDeleteEntity({ type: 'CHANNEL', id: op.channelId }),
          (error) => [{ code: 'DELETE', message: String(error) }]
        ).andTee(() =>
          Promise.all([
            queryClient.invalidateQueries({ queryKey: channelKeys._def }),
            queryClient.invalidateQueries({ queryKey: oldKeys._def }),
          ])
        );
    }
  })();
  const ok = result.isOk();
  if (
    ok &&
    ['approve', 'autojoin', 'bot-add', 'bot-remove'].includes(op.kind)
  ) {
    await Promise.allSettled([
      oldInvalidate(op.channelId),
      newInvalidate(op.channelId),
    ]);
  }
  return {
    ok,
    value: ok ? (result.value as unknown) : undefined,
    error: ok ? undefined : String(JSON.stringify(result.error)).slice(0, 200),
  };
}

/** The form tile's reach on both sides, once both have an answer or time runs out. */
async function invited(formId: string, ownerId: string, timeoutMs: number) {
  const host = document.createElement('div');
  let sources:
    | {
        old: ReturnType<typeof oldInvitedSource>;
        neu: ReturnType<typeof newInvitedSource>;
      }
    | undefined;
  const dispose = render(
    () => (
      <QueryClientContext.Provider value={() => queryClient}>
        {/* The app's Root provides the viewer; the head's channel batch reads it. */}
        <UserContextProvider>
          {(() => {
            sources = {
              old: oldInvitedSource(
                () => formId,
                () => ownerId,
                () => true
              ),
              neu: newInvitedSource(
                () => formId,
                () => ownerId,
                () => true
              ),
            };
            return null;
          })()}
        </UserContextProvider>
      </QueryClientContext.Provider>
    ),
    host
  );
  const answered = (source: { value: () => unknown; failure: () => unknown }) =>
    source.value() !== undefined || !!source.failure();
  const until = Date.now() + timeoutMs;
  while (
    Date.now() < until &&
    !(answered(sources!.old) && answered(sources!.neu))
  )
    await sleep(50);
  const read = (source: {
    value: () => number | null | undefined;
    failure: () => unknown;
  }) => ({
    value: source.value() ?? null,
    pending: source.value() === undefined,
    failure: source.failure()
      ? String(JSON.stringify(source.failure())).slice(0, 120)
      : null,
    reach: formReach(source.value()),
  });
  const result = { old: read(sources!.old), new: read(sources!.neu) };
  dispose();
  return result;
}

const api = {
  install(viewer: string) {
    me = viewer;
    return true;
  },
  setMutant(value: Mutant) {
    mutant = value;
    for (const entry of mounted.values()) entry.frozen = undefined;
  },
  mount(channels: { id: string; type: ChannelType }[]) {
    for (const channel of channels) mount(channel.id, channel.type);
    return mounted.size;
  },
  unmount(channelIds: string[]) {
    for (const id of channelIds) unmount(id);
  },
  settle,
  snapshot(channelIds: string[]) {
    return Object.fromEntries(
      channelIds.map((id) => [id, snapshotOne(id) ?? null])
    );
  },
  startActs(list: { id: string; act: Act }[]) {
    for (const { id, act } of list) startAct(id, act);
    return list.length;
  },
  releaseActs,
  write,
  invited,
};

declare global {
  interface Window {
    __px?: typeof api;
  }
}
window.__px = api;

export {};
