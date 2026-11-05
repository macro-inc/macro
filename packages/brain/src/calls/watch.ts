import { setTimeout as delay } from 'node:timers/promises';
import type { Emit } from './events.ts';
import type { ActiveCall, CallApi, Meeting } from './macro.ts';
import { rejoinDelay } from './retry.ts';

export type Invitation = {
  callId: string;
  kind: 'channel' | 'meeting';
  id: string;
  channel: string | null;
};
export type CallsConfig = {
  channels: string[];
  blockedChannels: string[];
  hungUp: string[];
  voice: string;
};
export type World = {
  me: string;
  calls: (ActiveCall & { ringing: boolean; dm: boolean; name: string })[];
  meetings: Meeting[];
  config: CallsConfig;
};
const customer = /^macro\s*(support\s*)?x\s/i;

export function wanted(world: World): Invitation[] {
  const { config, me } = world;
  const permitted = (id: string, name: string, channel: string | null) =>
    !config.hungUp.includes(id) &&
    !customer.test(name) &&
    (!channel || !config.blockedChannels.includes(channel));
  return [
    ...world.calls
      .filter(
        (call) =>
          call.createdBy !== me &&
          permitted(call.callId, call.name, call.channelId) &&
          (call.ringing || call.dm || config.channels.includes(call.channelId))
      )
      .map(
        (call): Invitation => ({
          callId: call.callId,
          kind: 'channel',
          id: call.channelId,
          channel: call.channelId,
        })
      ),
    ...world.meetings
      .filter(
        (meeting) =>
          meeting.createdBy !== me &&
          !!meeting.callId &&
          permitted(meeting.callId, meeting.title, meeting.channelId ?? null)
      )
      .map(
        (meeting): Invitation => ({
          callId: meeting.callId ?? meeting.id,
          kind: 'meeting',
          id: meeting.shareToken,
          channel: meeting.channelId ?? null,
        })
      ),
  ];
}

/** Owns one watcher and one session per call; failed sessions retry while live. */
export async function watchCalls(options: {
  api: CallApi;
  me: string;
  config(): Promise<CallsConfig>;
  ringing(): ReadonlySet<string>;
  onCall(invitation: Invitation, signal: AbortSignal): Promise<void>;
  emit: Emit;
  signal: AbortSignal;
}): Promise<void> {
  const running = new Map<string, AbortController>();
  const pending = new Set<Promise<void>>();
  const attempts = new Map<string, { failures: number; due: number }>();
  try {
    while (!options.signal.aborted) {
      try {
        const [calls, meetings, config] = await Promise.all([
          options.api.activeCalls(),
          options.api.meetings(),
          options.config(),
        ]);
        const detailed = await Promise.all(
          calls.map(async (call) => {
            try {
              return {
                ...call,
                ...(await options.api.channel(call.channelId)),
                ringing: options.ringing().has(call.callId),
              };
            } catch (error) {
              options.emit('watch.channel_error', { error: String(error) });
              return null;
            }
          })
        );
        const invitations = wanted({
          me: options.me,
          calls: detailed.filter((call) => call !== null),
          meetings,
          config,
        });
        for (const invitation of invitations) {
          if (
            running.has(invitation.callId) ||
            Date.now() < (attempts.get(invitation.callId)?.due ?? 0)
          )
            continue;
          const controller = new AbortController();
          running.set(invitation.callId, controller);
          const signal = AbortSignal.any([options.signal, controller.signal]);
          const run = options
            .onCall(invitation, signal)
            .then(() => {
              attempts.set(invitation.callId, {
                failures: 0,
                due: Date.now() + 15000,
              });
            })
            .catch((error: unknown) => {
              const failures =
                (attempts.get(invitation.callId)?.failures ?? 0) + 1;
              attempts.set(invitation.callId, {
                failures,
                due: Date.now() + rejoinDelay(failures),
              });
              options.emit('watch.join_error', {
                error: String(error),
                failures,
              });
            })
            .finally(() => {
              running.delete(invitation.callId);
              pending.delete(run);
            });
          pending.add(run);
        }
        for (const [id, controller] of running)
          if (config.hungUp.includes(id)) controller.abort();
        const live = new Set([
          ...calls.map((call) => call.callId),
          ...meetings.map((meeting) => meeting.callId),
        ]);
        for (const id of attempts.keys())
          if (!live.has(id) && !running.has(id)) attempts.delete(id);
      } catch (error) {
        options.emit('watch.error', { error: String(error) });
      }
      await delay(1000, undefined, { signal: options.signal });
    }
  } catch (error) {
    if (!options.signal.aborted) throw error;
  } finally {
    for (const controller of running.values()) controller.abort();
    await Promise.all(pending);
  }
}
