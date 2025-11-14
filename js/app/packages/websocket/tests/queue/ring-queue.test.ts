import { RingQueue } from '../../';
import { describe, test, expect } from 'vitest';

describe('Testsuite for RingQueue', () => {
  test('Initialization should throw on negative capacity', () => {
    expect(() => new RingQueue(-1)).toThrow();
    expect(() => new RingQueue(-42)).toThrow();
    expect(() => new RingQueue(-1001)).toThrow();
  });

  test('Initialization should throw on zero capacity', () => {
    expect(() => new RingQueue(0)).toThrow();
  });

  test('Initialization should not throw on positive capacity', () => {
    expect(() => new RingQueue(1)).not.toThrow();
    expect(() => new RingQueue(42)).not.toThrow();
    expect(() => new RingQueue(1001)).not.toThrow();
  });

  test('Add should add an element to the queue', () => {
    const queue = new RingQueue<number>(42);
    queue.add(1);
    expect(queue.length()).toBe(1);
    expect(queue.isEmpty()).toBe(false);
    expect(queue.read()).toBe(1);
  });

  test('Add should overwrite the oldest element if the queue is full', () => {
    const queue = new RingQueue<number>(42);
    for (let i = 0; i < 100; i++) {
      queue.add(i); // 0, 1, 2, ..., 99
    }
    expect(queue.read()).toBe(58); // 58, 59, ..., 99
  });

  test('Clear should remove all elements from the queue', () => {
    const queue = new RingQueue<number>(42);
    for (let i = 0; i < 100; i++) {
      queue.add(i);
    }
    queue.clear();
    expect(queue.length()).toBe(0);
    expect(queue.peek()).toBe(undefined);
    expect(queue.read()).toBe(undefined);
  });

  test('ForEach should iterate over all elements in the queue', () => {
    const queue = new RingQueue<number>(42);
    for (let i = 0; i < 100; i++) {
      queue.add(i);
    }
    let i = 58;
    queue.forEach((element) => {
      expect(element).toBe(i);
      i++;
    });
  });

  test('ForEach should not remove elements from the queue', () => {
    const queue = new RingQueue<number>(42);
    for (let i = 0; i < 100; i++) {
      queue.add(i);
    }
    let i = 58;
    queue.forEach((element) => {
      expect(element).toBe(i);
      i++;
    });
    queue.forEach((element) => {
      expect(queue.read()).toBe(element);
    });
  });

  test('Length should be zero on initialization', () => {
    expect(new RingQueue(1).length()).toBe(0);
    expect(new RingQueue(42).length()).toBe(0);
    expect(new RingQueue(1001).length()).toBe(0);
  });

  test('Length should be zero after clear', () => {
    const queue = new RingQueue<number>(42);
    queue.add(1);
    queue.add(2);
    queue.clear();
    expect(queue.length()).toBe(0);
  });

  test('Length should be zero after reading all elements', () => {
    const queue = new RingQueue<number>(42);
    queue.add(1);
    queue.add(2);
    queue.read();
    queue.read();
    expect(queue.length()).toBe(0);
  });

  test('Length should be equal to the number of available elements', () => {
    const queue = new RingQueue<number>(42);
    for (let i = 0; i < 100; i++) {
      queue.add(i);
      expect(queue.length()).toBe(Math.min(i + 1, 42));
    }
  });

  test('Length should be equal to the capacity after adding more elements than the capacity', () => {
    const queue = new RingQueue<number>(42);
    for (let i = 0; i < 100; i++) {
      queue.add(i);
    }
    expect(queue.length()).toBe(42);
  });

  test('Length should be equal to the number of available elements after reading', () => {
    const queue = new RingQueue<number>(42);
    for (let i = 0; i < 100; i++) {
      queue.add(i);
      expect(queue.length()).toBe(Math.min(i + 1, 42));
    }
    for (let i = 0; i < 100; i++) {
      queue.read();
      expect(queue.length()).toBe(Math.max(42 - i - 1, 0));
    }
  });

  test('Is empty should be true on initialization', () => {
    expect(new RingQueue(1).isEmpty()).toBe(true);
    expect(new RingQueue(42).isEmpty()).toBe(true);
    expect(new RingQueue(1001).isEmpty()).toBe(true);
  });

  test('Is empty should be true after clear', () => {
    const queue = new RingQueue<number>(42);
    queue.add(1);
    queue.add(2);
    queue.clear();
    expect(queue.isEmpty()).toBe(true);
  });

  test('Is empty should be true after reading all elements', () => {
    const queue = new RingQueue<number>(42);
    queue.add(1);
    queue.add(2);
    queue.read();
    queue.read();
    expect(queue.isEmpty()).toBe(true);
  });

  test('Is empty should be false after adding an element', () => {
    const queue = new RingQueue<number>(42);
    queue.add(1);
    expect(queue.isEmpty()).toBe(false);
  });

  test('Is empty should be false after adding more elements than the capacity', () => {
    const queue = new RingQueue<number>(42);
    for (let i = 0; i < 100; i++) {
      queue.add(i);
    }
    expect(queue.isEmpty()).toBe(false);
  });

  test('Peek should return undefined on initialization', () => {
    expect(new RingQueue(1).peek()).toBeUndefined();
    expect(new RingQueue(42).peek()).toBeUndefined();
    expect(new RingQueue(1001).peek()).toBeUndefined();
  });

  test('Peek should return undefined after clear', () => {
    const queue = new RingQueue<number>(42);
    queue.add(1);
    queue.add(2);
    queue.clear();
    expect(queue.peek()).toBeUndefined();
  });

  test('Peek should return the oldest element', () => {
    const queue = new RingQueue<number>(42);
    for (let i = 0; i < 100; i++) {
      queue.add(i);
      expect(queue.peek()).toBe(Math.max(i - 42 + 1, 0));
    }
  });

  test('Peek should not remove elements from the queue', () => {
    const queue = new RingQueue<number>(42);
    for (let i = 0; i < 100; i++) {
      queue.add(i);
      expect(queue.peek()).toBe(Math.max(i - 42 + 1, 0));
    }
    for (let i = 0; i < 100; i++) {
      expect(queue.peek()).toBe(58);
    }
  });

  test('Read should return undefined on initialization', () => {
    expect(new RingQueue(1).read()).toBeUndefined();
    expect(new RingQueue(42).read()).toBeUndefined();
    expect(new RingQueue(1001).read()).toBeUndefined();
  });

  test('Read should return undefined after clear', () => {
    const queue = new RingQueue<number>(42);
    queue.add(1);
    queue.add(2);
    queue.clear();
    expect(queue.read()).toBeUndefined();
  });

  test('Read should return undefined after reading all elements', () => {
    const queue = new RingQueue<number>(42);
    queue.add(1);
    queue.add(2);
    queue.read();
    queue.read();
    expect(queue.read()).toBeUndefined();
  });

  test('Read should return the oldest element', () => {
    const queue = new RingQueue<number>(42);
    queue.add(1);
    queue.add(2);
    expect(queue.read()).toBe(1);
    expect(queue.read()).toBe(2);
  });

  test('Read should return the oldest element after adding more elements than the capacity', () => {
    const queue = new RingQueue<number>(42);
    for (let i = 0; i < 100; i++) {
      queue.add(i);
    }
    for (let i = 0; i < 42; i++) {
      expect(queue.read()).toBe(100 - 42 + i);
    }
    expect(queue.read()).toBeUndefined();
  });
});
