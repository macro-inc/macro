/**
 * What calls add to the agent's context: Macro's calls, the ledgers, the
 * watcher that keeps it in at most one call, and what one call's process
 * runs on.
 * Everything here is made once, so the watcher's memory is shared by its
 * source and its handler. Nothing connects, polls or starts until used.
 */
import { behavior, type ContextOf } from '@macro-inc/muppet/core/behavior';
import { isoText } from '@macro-inc/muppet/utilities/time';
import { jsonLine } from '../../context/disk.ts';
import type { Base } from '../../context/index.ts';
import type { People, Work } from '../../contracts.ts';
import type { Chat } from '../chat/macro.ts';
import { readAsks } from './asks.ts';
import { callsPaths } from './config.ts';
import { ledgerPorts } from './context/ledgers.ts';
import { cliPath, running, signal, startJoin } from './context/processes.ts';
import { connectRoom, publishScreen } from './context/rooms.ts';
import { shareContext } from './context/share.ts';
import { voicePorts } from './context/voice.ts';
import { idList } from './ledger.ts';
import { sdkCalls } from './macro.ts';
import { askerLine, openingLine, pendingPlaced } from './place.ts';
import { liveJoins, pollMs, pulse, type Watcher, watchState } from './watch.ts';

/** What calls need from the rest of the agent: a way to post in Macro, somewhere to hand work, and what it knows of people. */
export type CallsNeeds = {
  readonly chat: Pick<Chat, 'send' | 'dm' | 'reply'>;
  readonly work: Work;
  readonly people: People;
};

export const callsContext = (
  base: Base,
  { chat, work, people }: CallsNeeds
) => {
  const { disk, clock, shell, config, join } = base;
  const paths = callsPaths(base);
  const api = sdkCalls({ macro: base.macro, connectRoom, publishScreen });
  const ledgers = ledgerPorts(base, {
    api,
    work,
    send: chat.send,
    dm: chat.dm,
  });
  /** Channels whose calls the agent always joins. */
  const allowed = idList({ file: paths.channels, disk });
  const beat = pulse(clock);
  const watcher: Watcher = {
    state: watchState(),
    pulse: beat,
    next: { ms: pollMs },
    api,
    allowed: allowed.read,
    hungUp: ledgers.hungUp.read,
    ports: {
      clock,
      paths,
      disk,
      joins: () => liveJoins(running({ disk, join }), cliPath(config, join)),
      start: startJoin({
        shell,
        disk,
        config,
        paths,
        join,
        relayed: base.relayed,
      }),
      signal,
      post: async (to, text) => {
        await ('channel' in to
          ? chat.send(to.channel, text)
          : chat.dm(to.dm, text));
      },
      reply: async (channel, root, text) => {
        await chat.reply(channel, root, text);
      },
      judgments: ledgers.judgments,
      placed: {
        pending: async () => pendingPlaced(await ledgers.outbound.read()),
        add: ledgers.outbound.add,
        expiredLine: (target) => askerLine(target, 'expired'),
      },
      asks: {
        read: async () => readAsks(await ledgers.asks.read()),
        add: ledgers.asks.add,
      },
      weigh: ledgers.weigh,
      topic: ledgers.callTopic,
      hangUp: ledgers.hungUp.add,
      // Every decision with its reason, where `callReport`'s reader and a person can find it.
      log: (entry) =>
        disk
          .append(
            paths.arbiter,
            jsonLine({ at: isoText(clock.now()), ...entry })
          )
          .catch(() => undefined),
      wake: beat.wake,
    },
  };
  const share = shareContext(base);
  /** What one call's process runs on. Loads nothing of LiveKit until a call starts. */
  const voice = voicePorts(base, {
    api,
    outbound: {
      pending: async (callId) =>
        (await ledgers.readPlaced(callId)) ?? undefined,
      add: ledgers.outbound.add,
    },
    tellNoAnswer: ledgers.tellNoAnswer,
    openingLine: (reason) => openingLine(config.identity.name, reason),
    hungUp: ledgers.hungUp,
    place: ledgers.place,
    makeShare: share.make,
    work,
    people,
  });
  return behavior<Base>().decorate({
    calls: { api, paths, watcher, allowed },
    ledgers,
    share,
    voice,
  });
};

export type CallsContext = ContextOf<ReturnType<typeof callsContext>>;
