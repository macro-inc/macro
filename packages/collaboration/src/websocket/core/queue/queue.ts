/**
 * A queue holds elements until they are read. The order in which elements are
 * read is determined by the implementation of the queue.
 */
export interface Queue<E> {
  /**
   * Adds an element to the queue.
   * @param element the element to add
   */
  add(element: E): void;

  /**
   * Clears the queue, removing all elements.
   */
  clear(): void;

  /**
   * Calls the given function for each element in the queue.
   * @param fn the function to call
   */
  forEach(fn: (element: E) => unknown): void;

  /**
   * Number of elements in the queue.
   * @return the number of elements in the queue
   */
  length(): number;

  /**
   * Whether the queue is empty.
   * @return true if the queue is empty, false otherwise
   */
  isEmpty(): boolean;

  /**
   * Returns the next element in the queue without removing it.
   * @return the next element in the queue, or undefined if the queue is empty
   */
  peek(): E | undefined;

  /**
   * Removes and returns the next element in the queue.
   * @return the next element in the queue, or undefined if the queue is empty
   */
  read(): E | undefined;
}
