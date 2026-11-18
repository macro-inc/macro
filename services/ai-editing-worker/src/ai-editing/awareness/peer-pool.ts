import PQueue from 'p-queue';
import { nextAiPeerId } from './ai-peer';
import { aiLabel, COLORS } from './awareness-source';

export type Peer = { name: string; color: string; peerId: bigint };

export type PeerPoolOptions = {
  colors?: string[];
  max?: number;
};

/**
 * Hands out writer identities for one edit. Every writer is labelled with the
 * editor — the agent or persona that asked for the edit — so readers see its
 * name on each cursor; writers differ only by peer id and color.
 */
export class PeerPool {
  private readonly name: string;
  private readonly colors: string[];
  private readonly free: Peer[] = []; // released, ready to reuse
  private readonly out = new Set<Peer>();
  private readonly releasers = new Map<Peer, () => void>(); // peer → free its slot
  private readonly gate: PQueue;

  private constructor(editor: string, opts?: PeerPoolOptions) {
    this.name = aiLabel(editor);
    this.colors = [...(opts?.colors ?? COLORS)];
    this.gate = new PQueue({ concurrency: opts?.max ?? 6 });
  }

  /** A pool whose every writer is labelled `editor`. */
  static forEditor(editor: string, opts?: PeerPoolOptions): PeerPool {
    return new PeerPool(editor, opts);
  }

  /** Acquire a writer identity, waiting if `max` are already out (semaphore). */
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

  /** A never-before-issued identity: a fresh peer id and the next color. */
  private mint(): Peer {
    const issued = this.out.size + this.free.length;
    const color = this.colors[issued % this.colors.length] ?? '';
    return { name: this.name, color, peerId: nextAiPeerId() };
  }
}
