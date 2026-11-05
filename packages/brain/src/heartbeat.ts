// The heartbeat wakes the agent only when something it tracks changed, or a
// sweep is due (Tod's collect + wakeReason). The snapshot is cheap: the
// self-state, schedules and work in flight; its hash lives in cache/.
import { join } from 'node:path';
import type { SelfState } from './memory.ts';
import type { InFlight } from './prompts.ts';
import type { Schedule } from './schedules.ts';

export function snapshotText(input: {
  self: SelfState;
  schedules: Schedule[];
  work: InFlight[];
}): string {
  const commitments = input.self.commitments.map(
    (commitment) =>
      `- ${commitment.what} (to ${commitment.to}, since ${commitment.since})`
  );
  const schedules = input.schedules.map(
    (schedule) => `- ${schedule.note} (${JSON.stringify(schedule.trigger)})`
  );
  const work = input.work.map(
    (run) => `- ${run.label} (task ${run.taskId}, since ${run.startedAt})`
  );
  return [
    `Focus: ${input.self.focus || '(none)'}`,
    'Commitments:',
    ...(commitments.length > 0 ? commitments : ['(none)']),
    'Schedules:',
    ...(schedules.length > 0 ? schedules : ['(none)']),
    'Work in flight:',
    ...(work.length > 0 ? work : ['(none)']),
  ].join('\n');
}

export async function snapshotHash(snapshot: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(snapshot)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  )
    .join('')
    .slice(0, 16);
}

export type WakeInput = {
  hash: string;
  lastHash: string;
  nowSeconds: number;
  lastRunSeconds: number;
  sweepHours: number;
};

/** Why to wake, or null to stay asleep. */
export function wakeReason(input: WakeInput): string | null {
  const reasons: string[] = [];
  if (input.hash !== input.lastHash) reasons.push('snapshot changed');
  if (input.nowSeconds - input.lastRunSeconds > input.sweepHours * 3600)
    reasons.push('sweep due');
  return reasons.length > 0 ? reasons.join('; ') : null;
}

export type HeartbeatRecord = { hash: string; lastRunSeconds: number };

/** The last woken snapshot hash and time, in `<dir>/heartbeat.json`. */
export class HeartbeatStore {
  constructor(private readonly dir: string) {}

  async read(): Promise<HeartbeatRecord> {
    try {
      return JSON.parse(
        await Deno.readTextFile(join(this.dir, 'heartbeat.json'))
      ) as HeartbeatRecord;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound)
        return { hash: '', lastRunSeconds: 0 };
      throw error;
    }
  }

  async write(state: HeartbeatRecord): Promise<void> {
    await Deno.mkdir(this.dir, { recursive: true });
    await Deno.writeTextFile(
      join(this.dir, 'heartbeat.json'),
      JSON.stringify(state)
    );
  }
}
