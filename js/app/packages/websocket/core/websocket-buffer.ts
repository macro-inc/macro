import type { WebsocketData } from './websocket-serializer';

/**
 * A WebsocketBuffer is used to store messages temporarily until they can be sent.
 */
export interface WebsocketBuffer<E = WebsocketData> {
  /**
   * Adds an element to the buffer.
   * @param element the element to add
   */
  add(element: E): void;

  /**
   * Reads an element from the buffer.
   * @return an element from the buffer or undefined if the buffer is empty
   */
  read(): E | undefined;
}
