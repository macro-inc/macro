import { expect } from 'vitest';
import type { CommitRecord, Snapshot } from './commands';
/** Persistent bijection: paths may move, identities may never be reused or rebound. */
export class Comparison {
  private previous: Snapshot | null = null;
  private uLife = { seen: new Set<string>(), retired: new Set<string>() };
  private rLife = { seen: new Set<string>(), retired: new Set<string>() };
  private track(snapshot: Snapshot, life: typeof this.uLife) {
    const live = new Set(snapshot.keys.map(({ key }) => key));
    const commit = snapshot.commit;
    const touched = commit
      ? [
          ...commit.dirtyLeaves,
          ...commit.dirtyElements.map(([key]) => key),
          ...commit.normalized,
          ...commit.mutations.map(([key]) => key),
        ]
      : [];
    for (const key of [...live, ...touched])
      expect(life.retired.has(key), `identity lifecycle: retired ${key}`).toBe(
        false
      );
    for (const [key, mutation] of commit?.mutations ?? []) {
      if (mutation === 'created')
        expect(life.seen.has(key), `identity lifecycle: recreated ${key}`).toBe(
          false
        );
      if (mutation === 'destroyed') life.retired.add(key);
    }
    // A normalized identity absent from the resulting tree was merged away.
    for (const key of commit?.normalized ?? [])
      if (!live.has(key)) life.retired.add(key);
    for (const key of [...live, ...touched]) life.seen.add(key);
  }
  private uToR = new Map<string, string>();
  private rToU = new Map<string, string>();
  private bind(u: string, r: string) {
    if (this.uToR.has(u)) expect(this.uToR.get(u)).toBe(r);
    if (this.rToU.has(r)) expect(this.rToU.get(r)).toBe(u);
    this.uToR.set(u, r);
    this.rToU.set(r, u);
  }
  compare(u: Snapshot, r: Snapshot) {
    this.track(u, this.uLife);
    this.track(r, this.rLife);
    expect(r.error, 'outcome').toEqual(u.error);
    expect(r.state, 'JSON structure and fields').toEqual(u.state);
    expect(r.selection, 'selection').toEqual(u.selection);
    expect(r.text, 'root text').toBe(u.text);
    expect(
      r.keys.map((k) => k.path),
      'node paths'
    ).toEqual(u.keys.map((k) => k.path));
    u.keys.forEach((k, i) => this.bind(k.key, r.keys[i].key));
    if (
      /^UTF-16 offset Utf16Offset\(\d+\) is out of range$/.test(
        u.error ?? ''
      ) &&
      r.commit === null &&
      u.commit !== null &&
      Object.values(u.commit).every((entries) => entries.length === 0)
    ) {
      // S1 D-13: upstream can publish empty recovery; Rust returns no commit.
      expect(this.previous, 'rollback baseline').not.toBeNull();
      for (const field of ['state', 'selection', 'text', 'keys'] as const)
        expect(r[field], `atomic rollback: ${field}`).toEqual(
          this.previous?.[field]
        );
      return;
    }
    this.previous = r;
    if (u.commit === null || r.commit === null) {
      expect(r.commit, 'commit presence').toEqual(u.commit);
      return;
    }
    // Allocations normalized away during the same update still participate in the bijection.
    const all = (c: CommitRecord) =>
      [
        ...new Set([
          ...c.dirtyLeaves,
          ...c.dirtyElements.map(([k]) => k),
          ...c.normalized,
          ...c.mutations.map(([k]) => k),
        ]),
      ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const unknownU = all(u.commit).filter((k) => !this.uToR.has(k));
    const unknownR = all(r.commit).filter((k) => !this.rToU.has(k));
    expect(unknownR.length, 'transient identities').toBe(unknownU.length);
    unknownU.forEach((k, i) => this.bind(k, unknownR[i]));
    const normalized = (c: CommitRecord, map: (k: string) => string) => ({
      dirtyLeaves: c.dirtyLeaves.map(map).sort(),
      dirtyElements: c.dirtyElements.map(([k, v]) => [map(k), v]).sort(),
      normalized: c.normalized.map(map).sort(),
      mutations: c.mutations.map(([k, v]) => [map(k), v]).sort(),
      tags: [...c.tags].sort(),
    });
    expect(
      normalized(r.commit, (k) => k),
      'commit'
    ).toEqual(normalized(u.commit, (k) => this.uToR.get(k) ?? `unmapped:${k}`));
  }
}
