// An unbounded async queue: `push` from one side, `for await` on the other.
// `close` ends iteration once the buffered items are consumed.
export class AsyncQueue<Item> implements AsyncIterable<Item> {
  private readonly buffered: Item[] = [];
  private readonly waiting: ((result: IteratorResult<Item>) => void)[] = [];
  private closed = false;
  get isClosed(): boolean {
    return this.closed;
  }
  push(item: Item): void {
    if (this.closed) throw new Error('push on a closed queue');
    const waiter = this.waiting.shift();
    if (waiter) {
      waiter({ value: item, done: false });
      return;
    }
    this.buffered.push(item);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiting.splice(0))
      waiter({ value: undefined, done: true });
  }
  [Symbol.asyncIterator](): AsyncIterator<Item> {
    return {
      next: () => {
        const item = this.buffered.shift();
        if (item !== undefined)
          return Promise.resolve({ value: item, done: false });
        if (this.closed)
          return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiting.push(resolve));
      },
    };
  }
}
