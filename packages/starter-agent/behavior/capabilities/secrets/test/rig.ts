/** A vault client over the stub, with a clock that moves only when told, and a clipboard in memory. */
import { log as makeLog } from '../../../context/log.ts';
import { state as makeState } from '../../../context/state.ts';
import { fixedClock, join, memoryDisk } from '../../../context/test/fakes.ts';
import { mintWakeId } from '../attribution.ts';
import type { Clipboard } from '../clipboard.ts';
import { vault } from '../vault.ts';
import { stubVault } from './stub.ts';

export const teamId = '11111111-1111-4111-8111-111111111111';
export const agentKey = 'relay-capability-token';
/** The origin a script's Macro client has for the storage service: the relay's. */
export const origin = 'http://127.0.0.1:40000/storage';

export const rig = (start = '2026-11-11T12:00:00Z') => {
  const clock = fixedClock(start);
  const stub = stubVault({ clock, teamId, agentKey });
  const disk = memoryDisk();
  const slept: number[] = [];
  let counter = 0;
  const bytes = () => {
    counter += 1;
    return new Uint8Array(10).fill(counter % 256);
  };
  const wake = mintWakeId(clock.now(), bytes());
  const pasted: string[] = [];
  const clipboard: Clipboard & { text: string | undefined } = {
    text: undefined,
    put: async (value) => {
      clipboard.text = value;
      pasted.push(value);
    },
    take: async () => {
      if (clipboard.text === undefined)
        throw new Error('the clipboard is empty');
      return clipboard.text;
    },
  };
  const client = vault({
    fetch: stub.fetch,
    endpoint: async () => ({ origin, key: agentKey }),
    team: async () => teamId,
    wakeId: () => wake,
    operationId: () => mintWakeId(clock.now(), bytes()),
    clock: {
      sleep: async (milliseconds) => {
        slept.push(milliseconds);
        await clock.sleep(milliseconds);
      },
    },
    jitter: () => 0.5,
  });
  const polling = { on: false };
  const context = {
    secrets: {
      vault: client,
      clipboard,
      polling: {
        ensure: async () => {
          polling.on = true;
        },
        stop: async () => {
          polling.on = false;
        },
      },
    },
    disk,
    join,
    state: makeState({ root: '/agent', join }),
    log: makeLog({ directory: '/agent/state/log/agent', join, disk, clock }),
  };
  return {
    clock,
    stub,
    disk,
    slept,
    wake,
    clipboard,
    pasted,
    client,
    context,
    polling,
  };
};
