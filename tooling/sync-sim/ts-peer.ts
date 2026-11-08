import { createInterface } from 'node:readline';
import type { PeerCommand, PeerReport } from './generated';
import { clock, WALL_ORIGIN, wakeAt } from './runtime';

// Imports happen after fake timers/entropy and the network-free transport exist.
const idb = await import('fake-indexeddb');
for (const [key, value] of Object.entries(idb)) {
  if (key === 'indexedDB' || key.startsWith('IDB'))
    Object.defineProperty(globalThis, key, { value, configurable: true });
}
const { effects } = await import('./transport');
const { command, finals, activity } = await import('./peer');
const loroPackage = await Bun.file(
  new URL('../../node_modules/loro-crdt/package.json', import.meta.url)
).json();
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
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (input.type === 'shutdown') process.exit(0);
}
