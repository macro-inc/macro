import PQueue from 'p-queue';
import { AI_NAMES, COLORS } from './awareness-source';

export type Peer = { name: string; color: string };

export class PeerPool {
  private readonly names: string[];
  private readonly colors: string[];
  private readonly free: Peer[] = []; // released, ready to reuse
  private readonly out = new Set<Peer>();
  private readonly releasers = new Map<Peer, () => void>(); // peer → free its slot
  private readonly gate: PQueue;
  private grown = 0; // suffix counter for names minted past the base list

  constructor(opts?: { names?: string[]; colors?: string[]; max?: number }) {
    this.names = [...(opts?.names ?? AI_NAMES)];
    this.colors = [...(opts?.colors ?? COLORS)];
    this.gate = new PQueue({ concurrency: opts?.max ?? 8 });
  }

  /** Acquire a unique identity, waiting if `max` are already out (semaphore). */
  borrow(): Promise<Peer> {
    return new Promise<Peer>((handOut) => {
      // The queued task holds a concurrency slot until its promise resolves; we
      // keep it pending and resolve it from release(), so the slot is occupied
      // for exactly the borrow's lifetime.
      void this.gate.add(
        () =>
          new Promise<void>((freeSlot) => {
            const peer = this.free.pop() ?? this.mint();
            this.out.add(peer);
            this.releasers.set(peer, freeSlot); // this.releasers.get()... .release() will release us
            handOut(peer); // okay, now we can hand out the peer
          })
      );
    });
  }

  release(p: Peer): void {
    if (!this.out.delete(p)) return; // unknown / double-release -> no-op
    this.free.push(p);
    const freeSlot = this.releasers.get(p);
    if (freeSlot) {
      this.releasers.delete(p);
      freeSlot(); // opens the slot for the next waiting borrow (resolves the promise)
    }
  }

  get outstanding(): number {
    return this.out.size;
  }

  /** A never-before-issued identity: next unused base name, else a suffixed one. */
  private mint(): Peer {
    const used = new Set([...this.out, ...this.free].map((p) => p.name));
    const name = this.names.find((n) => !used.has(n)) ?? this.growName(used);
    const color = this.colors[this.issued() % this.colors.length] ?? '';
    return { name, color };
  }

  private growName(used: Set<string>): string {
    let name: string;
    do {
      name = `Writer ${++this.grown} (AI)`;
    } while (used.has(name));
    return name;
  }

  private issued(): number {
    return this.out.size + this.free.length;
  }
}

/**
 * Process-wide pool.
 */
export const sharedPeerPool = new PeerPool();
