/**
 * A bounded pool of distinct loro peer ids, used as a semaphore so the AI's
 * edits are attributed to several distinct "authors" in the collab doc's
 * history (like a handful of collaborators), rather than all landing under one
 * peer id.
 *
 * We have this abstraction since lexical can get overwhelmed if too many people
 * are editing at once (we can potentially spawn an unbounded number of
 * subagents), and because it gives us more control.
 *
 * Each applied edit `borrow()`s a peer id, commits its loro change attributed to
 * that peer, then `release()`s it. When all N ids are checked out, `borrow()`
 * awaits until one is returned.
 *
 * Peer ids are plain bigints (loro's PeerID space is u64). The pool never mints
 * the same id twice and hands out only ids that are not currently borrowed.
 */
export class LoroPeerPool {
  /** All peer ids the pool owns, in a stable order. */
  private readonly all: readonly bigint[];
  /** Ids currently available to borrow, oldest-released first (FIFO). Rotating
   *  rather than reusing the most-recently-freed id means consecutive serial
   *   edits round-robin across distinct peers (which is nice since then peers
   *   have constantly different names :0)
   **/
  private readonly free: bigint[];
  /** Resolvers for borrowers waiting on a release, FIFO. */
  private readonly waiters: Array<(id: bigint) => void> = [];

  /**
   * @param ids the distinct peer ids this pool owns. Must be non-empty and free
   *   of duplicates.
   */
  public constructor(ids: readonly bigint[]) {
    if (ids.length === 0) throw new Error('LoroPeerPool needs at least one peer id');

    const seen = new Set<bigint>();
    for (const id of ids) {
      if (seen.has(id)) throw new Error(`duplicate peer id in pool: ${id}`);
      seen.add(id);
    }

    this.all = [...ids];
    this.free = [...ids];
  }

  /** Mint a pool of `size` distinct ids derived from a base seed. The base is
   *  typically offset from the doc's own peer id so the pool's ids never collide
   *  with it. Ids are `base + 1 .. base + size`. */
  public static fromSeed(base: bigint, size: number): LoroPeerPool {
    if (size <= 0) throw new Error('pool size must be positive');
    const ids: bigint[] = [];
    for (let i = 1; i <= size; i++) ids.push(base + BigInt(i));
    return new LoroPeerPool(ids);
  }

  /** Every peer id the pool owns (for up-front registration with the server). */
  public peerIds(): readonly bigint[] {
    return this.all;
  }

  /** The pool's capacity (the semaphore count). */
  public get size(): number {
    return this.all.length;
  }

  /** Number of ids currently available to borrow without awaiting. */
  public get available(): number {
    return this.free.length;
  }

  /** Take a peer id. Resolves immediately if one is free, otherwise awaits the
   *  next release. The returned id is not held by any other borrower until it is
   *  released. */
  public borrow(): Promise<bigint> {
    const id = this.free.shift();
    if (id !== undefined) return Promise.resolve(id);
    return new Promise<bigint>((resolve) => this.waiters.push(resolve));
  }

  /** Return a borrowed id. If a borrower is waiting, the id is handed straight to
   *  it; otherwise it goes back to the free list. */
  public release(id: bigint): void {
    const next = this.waiters.shift();
    if (next) {
      next(id);
      return;
    }
    this.free.push(id);
  }

  /**
   * Synchronously borrow-and-immediately-release one id, rotating to the next.
   * For a use site that attributes a single atomic, synchronous loro commit
   * (borrow → setPeerId → commit → release within one tick, never awaiting) this
   * is the right primitive: it never blocks, and successive calls cycle through
   * every pooled id so each edit lands under a different peer. Distinct from the
   * async `borrow()`/`release()` semaphore, which a caller uses to reserve a peer
   * across awaits (e.g. one peer per parallel writer queue).
   *
   * Returns `undefined` only if every id is currently checked out via the async
   * `borrow()` path — in which case the caller should fall back to the doc's own
   * peer id rather than steal a reserved one.
   */
  public rotate(): bigint | undefined {
    const id = this.free.shift();
    if (id === undefined) return undefined;
    this.free.push(id);
    return id;
  }

  /** Borrow, run `fn`, and release even if `fn` throws. */
  public async with<T>(fn: (id: bigint) => T | Promise<T>): Promise<T> {
    const id = await this.borrow();
    try {
      return await fn(id);
    } finally {
      this.release(id);
    }
  }
}
