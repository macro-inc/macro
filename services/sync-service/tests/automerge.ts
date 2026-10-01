/** Mutable test fixture around native Automerge. Wire bytes are never mocked. */
import * as A from '@automerge/automerge';
import { createHash, randomBytes } from 'node:crypto';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Root = Record<string, Json>;

export class Revision {
  constructor(readonly heads: A.Heads) {}
  encode() { return new TextEncoder().encode(JSON.stringify([...this.heads].sort())); }
  toJSON() { return [...this.heads].sort(); }
  static decode(bytes: Uint8Array) { return new Revision(JSON.parse(new TextDecoder().decode(bytes))); }
}

export class TestDocument {
  private value: A.Doc<Root>;
  readonly peerId: bigint;
  get peerIdStr() { return this.peerId.toString(); }
  constructor() {
    this.peerId = randomBytes(8).readBigUInt64BE();
    this.value = A.init({ actor: this.peerId.toString(16).padStart(16, '0') });
  }
  private ensure(key: string, kind: 'map' | 'text') {
    if (this.value[key] !== undefined) return;
    // Stable root creation lets two peers independently discover the same root.
    // Real applications initialize their schema in a shared snapshot instead.
    let seed = A.init<Root>({ actor: createHash('sha256').update(`test-root:${kind}:${key}`).digest('hex') });
    seed = A.change(seed, { time: 0 }, draft => { draft[key] = kind === 'map' ? {} : ''; });
    this.value = A.merge(this.value, seed);
    A.free(seed);
  }
  getMap(key: string) {
    this.ensure(key, 'map');
    const read = () => JSON.parse(JSON.stringify(this.value[key])) as Record<string, Json>;
    return {
      set: (field: string, value: Json) => { this.value = A.change(this.value, d => { (d[key] as Record<string, Json>)[field] = typeof value === 'string' ? new A.ImmutableString(value) as unknown as Json : value; }); },
      get: (field: string) => read()[field],
      delete: (field: string) => { this.value = A.change(this.value, d => { delete (d[key] as Record<string, Json>)[field]; }); },
      toJSON: () => structuredClone(read()),
    };
  }
  getText(key: string) {
    this.ensure(key, 'text');
    const insert = (index: number, value: string) => { this.value = A.change(this.value, d => A.splice(d, [key], index, 0, value)); };
    return {
      insert,
      push: (value: string) => insert((this.value[key] as string).length, value),
      update: (value: string) => { this.value = A.change(this.value, d => A.updateText(d, [key], value)); },
      delete: (index: number, count: number) => { this.value = A.change(this.value, d => A.splice(d, [key], index, count, '')); },
      toString: () => this.value[key] as string,
      getCursor: (index: number) => ({ encode: () => new TextEncoder().encode(A.getCursor(this.value, [key], index)) }),
    };
  }
  import(bytes: Uint8Array) {
    const before = A.getHeads(this.value);
    this.value = A.loadIncremental(this.value, bytes);
    const pending = A.getMissingDeps(this.value, []);
    return { success: new Map(A.getHeads(this.value).filter(h => !before.includes(h)).map(h => [h, true])), pending: pending.length ? pending : undefined };
  }
  importBatch(updates: Uint8Array[]) { for (const update of updates) this.import(update); }
  export(options: { mode: 'snapshot' | 'update'; from?: Revision }) {
    return options.mode === 'snapshot' ? A.save(this.value) : A.saveSince(this.value, options.from?.heads ?? []);
  }
  version() { return new Revision(A.getHeads(this.value)); }
  vvToFrontiers(version: Revision) { return version.heads; }
  toJSON() { return JSON.parse(JSON.stringify(this.value)); }
  commit() {}
  free() { A.free(this.value); }
}
