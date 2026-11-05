import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { dispose } from '@livekit/rtc-node';
import type { MacroHttp } from '../macro.ts';
import { withSpan } from '../telemetry.ts';
import type { BrainCall } from '../wiring.ts';
import { claudeBrain } from './brain.ts';
import { parseCallsConfig } from './config.ts';
import type { Emit } from './events.ts';
import { joinCall } from './join.ts';
import { macroCalls } from './macro.ts';
import type { SpeechGateway } from './speech.ts';
import { watchCalls } from './watch.ts';
export type CallPolicy = {
  voice?: string;
  answer?: (who: string, text: string) => boolean;
  allowHandOff?: boolean;
};
export type CallSelf = {
  context(): Promise<{
    name: string;
    operating: string;
    model: string;
    voice: string;
    briefing: string;
    budgetUsd: number;
  }>;
  handOff(channel: string, task: string): Promise<string>;
  finished(id: string, channel: string | null, summary: string): Promise<void>;
  hungUp(id: string): Promise<void>;
  spent(usd: number): Promise<void>;
};
/** Credentials stay inside the installed transport, outside agent-owned wiring. */
export interface CallTransport {
  watch(
    dispatch: (call: BrainCall) => Promise<void>,
    signal: AbortSignal
  ): Promise<void>;
  join(call: BrainCall, self: CallSelf, policy?: CallPolicy): Promise<void>;
}
export function callTransport(options: {
  workspace: string;
  http: MacroHttp;
  gateway: SpeechGateway;
  modelOptions: Options;
  ringing(): ReadonlySet<string>;
  emit: Emit;
}): CallTransport {
  const active = new Map<string, AbortSignal>();
  let dispatch: (call: BrainCall) => Promise<void> = async () => {};
  const directory = join(options.workspace, 'log', 'calls');
  const config = async () => {
    const config = parseCallsConfig(
      JSON.parse(
        await readFile(join(options.workspace, 'config/calls.json'), 'utf8')
      )
    );
    try {
      config.hungUp = JSON.parse(
        await readFile(
          join(options.workspace, 'cache/call-hungup.json'),
          'utf8'
        )
      );
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
      )
        throw error;
    }
    return config;
  };
  return {
    async watch(handler, signal) {
      dispatch = handler;
      await pruneCalls(directory);
      const me = (await options.http.me()).user_id;
      try {
        await watchCalls({
          api: macroCalls(options.http),
          me,
          config,
          ringing: options.ringing,
          signal,
          emit: options.emit,
          async onCall(invitation, callSignal) {
            active.set(invitation.callId, callSignal);
            try {
              await dispatch({
                id: invitation.callId,
                phase: 'incoming',
                metadata: {
                  kind: invitation.kind,
                  destination: invitation.id,
                  channel: invitation.channel,
                },
              });
            } finally {
              active.delete(invitation.callId);
            }
          },
        });
      } finally {
        await dispose();
      }
    },
    async join(call, self, policy = {}) {
      if (call.phase !== 'incoming') return;
      const signal = active.get(call.id);
      if (!signal) throw new Error('call invitation is no longer active');
      const { kind, destination, channel } = call.metadata;
      if (
        (kind !== 'channel' && kind !== 'meeting') ||
        typeof destination !== 'string' ||
        (channel !== null && typeof channel !== 'string')
      )
        throw new Error('invalid call invitation');
      const context = await self.context();
      if (context.budgetUsd <= 0)
        throw new Error('daily call budget exhausted');
      const costs: Promise<void>[] = [];
      try {
        await withSpan('brain.call', { 'call.id': call.id }, () =>
          joinCall({
            invitation: { callId: call.id, kind, id: destination, channel },
            api: macroCalls(options.http),
            gateway: options.gateway.forName(context.name),
            names: [context.name],
            voice: policy.voice ?? context.voice,
            directory,
            signal,
            answer: policy.answer,
            brain: (emit, onHangUp) =>
              claudeBrain({
                callId: call.id,
                channel: channel ?? '',
                emit: (type, data) => {
                  emit(type, data);
                  if (type === 'brain.result' && typeof data?.cost === 'number')
                    costs.push(self.spent(data.cost));
                },
                onHangUp,
                operating: context.operating,
                briefing: async () => context.briefing,
                options: {
                  ...options.modelOptions,
                  model: context.model,
                  cwd: options.workspace,
                  maxBudgetUsd: context.budgetUsd,
                },
                handOff: async (task) => {
                  if (policy.allowHandOff === false)
                    throw new Error('hand-offs are disabled for this call');
                  if (!channel)
                    throw new Error(
                      'this call has no conversation for reporting work'
                    );
                  return self.handOff(channel, task);
                },
              }),
            hungUp: self.hungUp,
            finished: self.finished,
            lifecycle: (phase) => dispatch({ ...call, phase }),
          })
        );
      } finally {
        await Promise.all(costs);
      }
    },
  };
}
/** Private diagnostics expire after seven days; keep at most fifty call directories. */
export async function pruneCalls(
  directory: string,
  now = Date.now()
): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return;
    throw error;
  }
  const calls = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => ({
        path: join(directory, entry.name),
        time: (await stat(join(directory, entry.name))).mtimeMs,
      }))
  );
  calls.sort((a, b) => b.time - a.time);
  for (const [index, call] of calls.entries())
    if (index >= 50 || now - call.time > 7 * 86400000)
      await rm(call.path, { recursive: true });
}
