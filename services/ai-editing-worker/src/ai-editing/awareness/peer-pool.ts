import PQueue from 'p-queue';
import { nextAiPeerId } from './ai-peer';
import { AI_NAMES, aiLabel, COLORS } from './awareness-source';

export type Peer = { name: string; color: string; peerId: bigint };

export type PeerPoolOptions = {
  names?: string[];
  colors?: string[];
  max?: number;
  /**
   * Whether every outstanding peer needs its own name (default). Off, the
   * pool cycles through `names` and lets writers share one: how a single
   * persona edits with several cursors at once.
   */
  distinctNames?: boolean;
};

export class PeerPool {
  private readonly names: string[];
  private readonly colors: string[];
  private readonly distinctNames: boolean;
  private readonly free: Peer[] = []; // released, ready to reuse
  private readonly out = new Set<Peer>();
  private readonly releasers = new Map<Peer, () => void>(); // peer → free its slot
  private readonly gate: PQueue;

  constructor(opts?: PeerPoolOptions) {
    this.names = [...(opts?.names ?? AI_NAMES)];
    this.colors = [...(opts?.colors ?? COLORS)];
    this.distinctNames = opts?.distinctNames ?? true;
    this.gate = new PQueue({ concurrency: opts?.max ?? 6 });
  }

  /**
   * A pool whose every writer is `editor` — the agent or persona that asked for
   * the edit — so readers see its name on each cursor, not a pooled one.
   */
  static forEditor(
    editor: string,
    opts?: Omit<PeerPoolOptions, 'names' | 'distinctNames'>
  ): PeerPool {
    return new PeerPool({
      ...opts,
      names: [aiLabel(editor)],
      distinctNames: false,
    });
  }

  /** Acquire a unique identity, waiting if `max` are already out (semaphore). */
  public borrow(): Promise<Peer> {
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

  public release(p: Peer): void {
    if (!this.out.delete(p)) return; // unknown / double-release -> no-op
    this.free.push(p);
    const freeSlot = this.releasers.get(p);
    if (freeSlot) {
      this.releasers.delete(p);
      freeSlot(); // opens the slot for the next waiting borrow (resolves the promise)
    }
  }

  public get outstanding(): number {
    return this.out.size;
  }

  /** A never-before-issued identity: next unused base name, else a suffixed one. */
  private mint(): Peer {
    const color = this.colors[this.issued() % this.colors.length] ?? '';
    if (!this.distinctNames) {
      const name = this.names[this.issued() % this.names.length] ?? 'AI';
      return { name, color, peerId: nextAiPeerId() };
    }

    const used = new Set([...this.out, ...this.free].map((p) => p.name));
    const unusedBaseName = this.names.find((name) => !used.has(name));
    let name = unusedBaseName;

    if (!name) {
      const baseNames = this.names.length > 0 ? this.names : ['AI'];
      let generation = Math.floor(this.issued() / baseNames.length) + 1;
      let candidate = `${baseNames[this.issued() % baseNames.length]} ${generation}`;

      while (used.has(candidate)) {
        generation += 1;
        candidate = `${baseNames[this.issued() % baseNames.length]} ${generation}`;
      }
      name = candidate;
    }

    return { name, color, peerId: nextAiPeerId() };
  }

  private issued(): number {
    return this.out.size + this.free.length;
  }
}
