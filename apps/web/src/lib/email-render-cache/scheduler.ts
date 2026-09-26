export function cancelled(): DOMException {
  return new DOMException('Email preparation cancelled', 'AbortError');
}

interface Job {
  priority: () => number;
  valid: () => boolean;
  run(): Promise<void>;
  reject(error: unknown): void;
}

/** One running operation. Priority affects queued work, never an active parser. */
export class PreparationScheduler {
  private queue: Job[] = [];
  private running = false;
  private disposed = false;

  schedule<T>(
    priority: () => number,
    valid: () => boolean,
    run: () => Promise<T>
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.disposed || !valid()) return reject(cancelled());
      if (
        priority() > 0 &&
        this.queue.filter((job) => job.priority() > 0).length >= 32
      )
        return reject(cancelled());
      this.queue.push({
        priority,
        valid,
        reject,
        run: async () => {
          resolve(await run());
        },
      });
      if (!this.running) queueMicrotask(() => void this.drain());
    });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length && !this.disposed) {
        this.queue.sort((a, b) => a.priority() - b.priority());
        const job = this.queue.shift()!;
        try {
          if (!job.valid()) throw cancelled();
          await job.run();
        } catch (error) {
          job.reject(error);
        }
      }
    } finally {
      this.running = false;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const job of this.queue.splice(0)) job.reject(cancelled());
  }
}
