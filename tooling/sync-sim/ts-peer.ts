import { mock } from 'bun:test';
import { createInterface } from 'node:readline';
import type { PeerCommand, PeerReport } from './generated';
import { activity, clock, WALL_ORIGIN, wakeAt } from './runtime';

// Each child selects its actual Loro implementation before importing the shipping
// engine/mirror. The legacy lane exercises real 1.16 updates against native 1.17.
const lane = process.argv[3];
if (lane !== 'current' && lane !== 'legacy')
  throw new Error('peer requires a current or legacy Loro lane');
const packageName = lane === 'legacy' ? 'loro-crdt-legacy' : 'loro-crdt';
const loroPackage = await Bun.file(
  new URL('../package.json', import.meta.resolve(packageName))
).json();
if (lane === 'legacy') {
  const legacy = await import('loro-crdt-legacy');
  mock.module(Bun.resolveSync('loro-crdt', import.meta.dir), () => legacy);
  const selected = await import('loro-crdt');
  if (selected.LoroDoc !== legacy.LoroDoc)
    throw new Error('legacy Loro implementation was not installed');
}

// Imports happen after fake timers/entropy and the network-free transport exist.
const idb = await import('fake-indexeddb');
for (const [key, value] of Object.entries(idb)) {
  if (key === 'indexedDB' || key.startsWith('IDB'))
    Object.defineProperty(globalThis, key, { value, configurable: true });
}
const { effects } = await import('./transport');
const { command, finals } = await import('./peer');
for await (const line of createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})) {
  const input: PeerCommand = JSON.parse(line);
  await command(input);
  await activity.drain();
  const peers = await finals();
  await activity.drain();
  const report: PeerReport = {
    version: 1,
    loro_version: loroPackage.version,
    now: clock.now - WALL_ORIGIN,
    wake_at: wakeAt(),
    effects: effects.splice(0),
    peers,
  };
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(report)}\n`, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  if (input.type === 'shutdown') process.exit(0);
}
