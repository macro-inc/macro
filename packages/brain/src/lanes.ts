// One durable serial queue per conversation (crates/agent_brain queue.rs).
//
// `push` appends to `<dir>/<lane>.jsonl` and starts the lane's worker if it
// is idle. The worker renames the file to `<lane>.batch`, hands the whole
// batch to the handler (a burst becomes one turn), deletes it on success,
// and loops until the lane is empty. Lanes run in parallel; one lane never
// runs two batches at once. A crash leaves `.batch` behind and `resume`
// runs it again first. A failed batch moves to `<dir>/failed/`.
import { join } from 'node:path';

const QUEUE = 'jsonl';
const BATCH = 'batch';

/** A lane key safe as a file name (UUIDs pass through unchanged). */
export const laneKey = (conversation: string) =>
  conversation.replace(/[^A-Za-z0-9._-]/g, '_');

export type LaneHandler<Item> = (lane: string, batch: Item[]) => Promise<void>;

export class Lanes<Item> {
  private readonly active = new Set<string>();
  private readonly running = new Set<Promise<void>>();
  private stopped = false;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dir: string,
    private readonly handler: LaneHandler<Item>,
    private readonly log: (line: object) => void
  ) {}

  private path(key: string, extension: string) {
    return join(this.dir, `${key}.${extension}`);
  }

  /** Appends and takes never interleave, so an append never lands in a batch being read. */
  private locked<Result>(step: () => Promise<Result>): Promise<Result> {
    const next = this.lock.then(step);
    this.lock = next.catch(() => undefined);
    return next;
  }

  push(conversation: string, item: Item): Promise<void> {
    const key = laneKey(conversation);
    return this.locked(async () => {
      await Deno.mkdir(this.dir, { recursive: true });
      await Deno.writeTextFile(
        this.path(key, QUEUE),
        `${JSON.stringify(item)}\n`,
        { append: true }
      );
      this.start(key);
    });
  }

  /** Start a worker for every lane with work on disk. Call once at startup. */
  async resume(): Promise<number> {
    await Deno.mkdir(this.dir, { recursive: true });
    let started = 0;
    for await (const entry of Deno.readDir(this.dir)) {
      const match = /^(.+)\.(jsonl|batch)$/.exec(entry.name);
      if (!entry.isFile || !match?.[1] || this.active.has(match[1])) continue;
      this.start(match[1]);
      started++;
    }
    return started;
  }

  /** Items waiting in a lane, the batch in progress first. */
  async pending(conversation: string): Promise<Item[]> {
    const key = laneKey(conversation);
    return [
      ...(await readJsonl<Item>(this.path(key, BATCH))),
      ...(await readJsonl<Item>(this.path(key, QUEUE))),
    ];
  }

  /** Wait until every lane has drained, including batches pushed while waiting. */
  async settled(): Promise<void> {
    while (this.running.size > 0) await Promise.all(this.running);
  }

  /** Stop starting batches and wait for the running ones. */
  async shutdown(): Promise<void> {
    this.stopped = true;
    await Promise.all(this.running);
  }

  private start(key: string) {
    if (this.stopped || this.active.has(key)) return;
    this.active.add(key);
    const worker = this.drain(key)
      .catch((error) => {
        this.active.delete(key);
        this.log({ lane: key, worker_stopped: String(error) });
      })
      .finally(() => this.running.delete(worker));
    this.running.add(worker);
  }

  private async drain(key: string): Promise<void> {
    for (;;) {
      const batch = await this.locked(async () => {
        const taken = this.stopped ? null : await this.take(key);
        // Under the lock, so a push that comes next starts a new worker.
        if (taken === null) this.active.delete(key);
        return taken;
      });
      if (batch === null) return;

      const batchPath = this.path(key, BATCH);
      try {
        await this.handler(key, batch);
        await Deno.remove(batchPath);
      } catch (error) {
        this.log({
          lane: key,
          items: batch.length,
          batch_failed: String(error),
        });
        const failed = join(this.dir, 'failed');
        await Deno.mkdir(failed, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '');
        await Deno.rename(batchPath, join(failed, `${key}-${stamp}.jsonl`));
      }
    }
  }

  /** The interrupted batch if there is one, else the queued items renamed into a new batch. */
  private async take(key: string): Promise<Item[] | null> {
    const batchPath = this.path(key, BATCH);
    for (;;) {
      if (!(await exists(batchPath))) {
        const queuePath = this.path(key, QUEUE);
        if (!(await exists(queuePath))) return null;
        await Deno.rename(queuePath, batchPath);
      }
      const items = await readJsonl<Item>(batchPath);
      if (items.length > 0) return items;
      await Deno.remove(batchPath);
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

export async function readJsonl<Item>(path: string): Promise<Item[]> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Item);
}
