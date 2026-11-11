/**
 * Reading the call watcher from outside it: what it sees right now, what it
 * decided and why, and the channels whose calls the agent always joins.
 */
import { lastLines } from '../../../context/disk.ts';
import { wanted } from '../arbiter.ts';
import { readAsks } from '../asks.ts';
import type { CallsContext } from '../context.ts';
import { pendingPlaced } from '../place.ts';
import { world } from '../watch.ts';
import { filled } from './filled.ts';

type Live = {
  readonly callId: string;
  readonly kind: 'channel' | 'meeting';
  /** The channel's name, or the meeting's title. */
  readonly name: string;
  readonly createdBy: string;
  readonly dm?: boolean;
};

/**
 * The calls you could be on right now: live calls and meetings, the one
 * you're in, calls waiting to be placed, and open asks to come.
 *
 * Read-only, and asks Macro afresh. `wants` is what would seat you if you
 * were free, by the arbiter's standing rules (a DM, your owner's meeting, a listed
 * channel); calls nobody rang you for are decided separately, and
 * `callDecisions` shows how. `joins` are your call processes alive on this
 * machine. The watcher inside `bin/agent run` acts on all of this every few
 * seconds; nothing here joins or leaves a call.
 */
export const callsNow = async ({
  calls: { watcher },
  ledgers,
  config,
}: CallsContext) => {
  const { api, allowed, hungUp, ports } = watcher;
  const read = await world({
    api,
    me: await api.me(),
    owner: config.owner,
    allowed,
    hungUp,
  });
  const placing = pendingPlaced(await ledgers.outbound.read());
  const live: readonly Live[] = [
    ...read.calls.map(({ callId, name, createdBy, dm }) => ({
      callId,
      kind: 'channel' as const,
      name,
      createdBy,
      dm,
    })),
    ...read.meetings.map(({ callId, title, createdBy }) => ({
      callId,
      kind: 'meeting' as const,
      name: title,
      createdBy,
    })),
  ];
  return {
    live,
    wants: wanted({ ...read, placed: placing }).map(
      ({ callId, event, why }) => ({ callId, event, why })
    ),
    joins: (await ports.joins()).map(({ pid, callId }) => ({ pid, callId })),
    placing: placing.map(({ id, target, reason }) => ({
      id,
      target,
      reason,
    })),
    asks: readAsks(await ledgers.asks.read()).open.map(
      ({ id, from, callId }) => ({ id, from, callId })
    ),
  };
};

/** The most decisions one read returns. */
const mostDecisions = 500;

/**
 * What the call watcher decided lately and why: joins, moves, busy lines,
 * asks, placed calls.
 *
 * The newest lines of the arbiter's log, oldest first, optionally only one
 * call's: `count` of them (40 by default, a whole number from 1 to 500).
 * Each decision is logged once per change of mind, with the rule
 * (`event`) that made it. Every rule is a row in
 * behavior/capabilities/calls/arbiter.ts.
 */
export const callDecisions = async (
  { calls: { paths }, disk }: CallsContext,
  {
    callId,
    count = 40,
  }: { readonly callId?: string; readonly count?: number } = {}
): Promise<readonly unknown[]> => {
  if (!Number.isInteger(count) || count < 1 || count > mostDecisions)
    throw new Error(
      `count must be a whole number from 1 to ${mostDecisions}, not ${count}`
    );
  const lines = lastLines((await disk.read(paths.arbiter)) ?? '', 5000);
  return lines
    .flatMap((line): unknown[] => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    })
    .filter(
      (entry) => callId === undefined || JSON.stringify(entry).includes(callId)
    )
    .slice(-count);
};

/**
 * The channels whose calls you always join; add or remove one.
 *
 * A call in a listed channel is joined without a judgment, like a DM. With no
 * input, lists them; `channelId` must not be empty.
 */
export const alwaysJoinCalls = async (
  { calls: { allowed } }: CallsContext,
  input?: { readonly channelId: string; readonly remove?: boolean }
): Promise<readonly string[]> => {
  if (input !== undefined) {
    const { channelId, remove } = input;
    filled(channelId, 'channelId');
    await (remove === true
      ? allowed.remove(channelId)
      : allowed.add(channelId));
  }
  return [...(await allowed.read())].sort();
};
