import { ArrayQueue } from '../../';
import { describe, test, expect } from 'vitest';

describe('Testsuite for ArrayQueue', () => {
  test('Queue should be empty after initialization', () => {
    expect(new ArrayQueue().isEmpty()).toBe(true);
  });

  test('Add should add an element to the queue', () => {
    const queue = new ArrayQueue<number>();
    queue.add(1);
    expect(queue.length()).toBe(1);
    expect(queue.isEmpty()).toBe(false);
    expect(queue.read()).toBe(1);
  });

  test('Add multiple elements should add all elements to the queue', () => {
    const queue = new ArrayQueue<number>();
    for (let i = 0; i < 100; i++) {
      queue.add(i);
      expect(queue.length()).toBe(i + 1);
    }
  });

  test('Clear should remove all elements from the queue', () => {
    const queue = new ArrayQueue<number>();
    for (let i = 0; i < 100; i++) {
      queue.add(i);
    }
    queue.clear();
    expect(queue.length()).toBe(0);
    expect(queue.peek()).toBe(undefined);
    expect(queue.read()).toBe(undefined);
  });

  test('ForEach should iterate over all elements in the queue', () => {
    const queue = new ArrayQueue<number>();
    for (let i = 0; i < 100; i++) {
      queue.add(i);
    }
    let i = 0;
    queue.forEach((element) => {
      expect(element).toBe(i);
      i++;
    });
  });

  test('ForEach should not remove elements from the queue', () => {
    const queue = new ArrayQueue<number>();
    for (let i = 0; i < 100; i++) {
      queue.add(i);
    }
    let i = 0;
    queue.forEach((element) => {
      expect(element).toBe(i);
      i++;
    });
    const es: number[] = [];
    queue.forEach((element) => es.push(element));
    expect(es.length).toBe(100);
  });

  test('Length should be zero on initialization', () => {
    expect(new ArrayQueue().length()).toBe(0);
  });

  test('Length should be zero after clear', () => {
    const queue = new ArrayQueue<number>();
    for (let i = 0; i < 100; i++) {
      queue.add(i);
    }
    queue.clear();
    expect(queue.length()).toBe(0);
  });

  test('Length should be zero after reading all elements', () => {
    const queue = new ArrayQueue<number>();
    for (let i = 0; i < 100; i++) {
      queue.add(i);
    }
    for (let i = 0; i < 100; i++) {
      queue.read();
    }
    expect(queue.length()).toBe(0);
    expect(queue.isEmpty()).toBe(true);
    expect(queue.peek()).toBeUndefined();
    expect(queue.read()).toBeUndefined();
  });

  test('IsEmpty should be true after initialization', () => {
    expect(new ArrayQueue().isEmpty()).toBe(true);
  });

  test('IsEmpty should be true after clear', () => {
    const queue = new ArrayQueue<number>();
    for (let i = 0; i < 100; i++) {
      queue.add(i);
    }
    queue.clear();
    expect(queue.isEmpty()).toBe(true);
  });

  test('IsEmpty should be true after reading all elements', () => {
    const queue = new ArrayQueue<number>();
    for (let i = 0; i < 100; i++) {
      queue.add(i);
    }
    for (let i = 0; i < 100; i++) {
      queue.read();
    }
    expect(queue.isEmpty()).toBe(true);
  });

  test('Peek should return undefined on initialization', () => {
    expect(new ArrayQueue().peek()).toBeUndefined();
  });

  test('Peek should return undefined after clear', () => {
    const queue = new ArrayQueue<number>();
    for (let i = 0; i < 100; i++) {
      queue.add(i);
    }
    queue.clear();
    expect(queue.peek()).toBeUndefined();
  });

  test('Peek should return the oldest element', () => {
    const queue = new ArrayQueue<number>();
    for (let i = 0; i < 100; i++) {
      queue.add(i);
      expect(queue.peek()).toBe(0);
    }
  });

  test('Peek should not remove the oldest element', () => {
    const queue = new ArrayQueue<number>();
    for (let i = 0; i < 100; i++) {
      queue.add(i);
      expect(queue.peek()).toBe(0);
    }
  });

  test('Read should return undefined on initialization', () => {
    expect(new ArrayQueue().read()).toBeUndefined();
  });

  test('Read should return undefined after clear', () => {
    const queue = new ArrayQueue<number>();
    queue.add(1);
    queue.add(2);
    queue.clear();
    expect(queue.read()).toBeUndefined();
  });

  test('Read should return undefined after reading all elements', () => {
    const queue = new ArrayQueue<number>();
    queue.add(1);
    queue.add(2);
    queue.read();
    queue.read();
    expect(queue.read()).toBeUndefined();
  });

  test('Read should return the oldest element', () => {
    const queue = new ArrayQueue<number>();
    queue.add(1);
    queue.add(2);
    expect(queue.read()).toBe(1);
    expect(queue.read()).toBe(2);
  });
});
