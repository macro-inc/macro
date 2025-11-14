import { Queue } from './queue';

/**
 * A ring queue is a queue that has a fixed capacity. When the queue is full, the oldest element is
 * removed to make room for the new element. Reading from a ring queue will return the oldest
 * element and effectively remove it from the queue.
 */
export class RingQueue<E> implements Queue<E> {
  private readonly elements: E[];
  private head: number; // index of the next position to write to
  private tail: number; // index of the next position to read from

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('Capacity must be a positive integer');
    }

    this.elements = new Array<E>(capacity + 1); // +1 to distinguish between full and empty
    this.head = 0;
    this.tail = 0;
  }

  add(element: E): void {
    this.elements[this.head] = element;
    this.head = (this.head + 1) % this.elements.length;
    if (this.head === this.tail) {
      this.tail = (this.tail + 1) % this.elements.length;
    }
  }

  clear() {
    this.head = 0;
    this.tail = 0;
  }

  forEach(fn: (element: E) => unknown) {
    for (
      let i = this.tail;
      i !== this.head;
      i = (i + 1) % this.elements.length
    ) {
      fn(this.elements[i]);
    }
  }

  length(): number {
    return this.tail === this.head
      ? 0
      : this.tail < this.head
        ? this.head - this.tail
        : this.elements.length - this.tail + this.head;
  }

  isEmpty(): boolean {
    return this.head === this.tail;
  }

  peek(): E | undefined {
    return this.isEmpty() ? undefined : this.elements[this.tail];
  }

  read(): E | undefined {
    const e = this.peek();
    if (e !== undefined) {
      this.tail = (this.tail + 1) % this.elements.length;
    }
    return e;
  }
}
