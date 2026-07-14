import type { Queue } from './queue';

/**
 * An array queue is a queue that has an unbounded capacity. Reading from an array queue
 * will return the oldest element and effectively remove it from the queue.
 */
export class ArrayQueue<E> implements Queue<E> {
  private readonly elements: E[];

  constructor() {
    this.elements = [];
  }

  add(element: E): void {
    this.elements.push(element);
  }

  clear() {
    this.elements.length = 0;
  }

  forEach(fn: (element: E) => unknown) {
    this.elements.forEach(fn);
  }

  length(): number {
    return this.elements.length;
  }

  isEmpty(): boolean {
    return this.elements.length === 0;
  }

  peek(): E | undefined {
    return this.elements[0];
  }

  read(): E | undefined {
    return this.elements.shift();
  }
}
