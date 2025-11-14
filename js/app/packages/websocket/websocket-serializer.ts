export type WebsocketData = string | ArrayBufferLike | Blob | ArrayBufferView;

/**
 * Websocket message serializer.
 * Serializes data send, and deserializes data on message-event.
 */
export interface WebsocketSerializer<
  Send = WebsocketData,
  Receive = WebsocketData,
> {
  /**
   * Serializes data send.
   * @param data the data to serialize
   * @return the serialized data
   */
  serialize(data: Send): WebsocketData;
  /**
   * Deserializes data on message-event.
   * @param data the data to deserialize
   * @return the deserialized data
   */
  deserialize(data: WebsocketData): Receive;

  binaryType?: BinaryType;
}

/**
 * Type guard to check if this is default websocket data.
 */
export function isDefaultWebsocketData(data: unknown): data is WebsocketData {
  return (
    typeof data === 'string' ||
    data instanceof ArrayBuffer ||
    data instanceof Blob ||
    ArrayBuffer.isView(data)
  );
}

/**
 * Serializes data send, if a serializer is provided.
 * @param data the data to serialize
 * @param serializer the serializer to use
 * @return the serialized data
 */
export function serializeIfNeeded<
  Send = WebsocketData,
  Receive = WebsocketData,
>(
  data: Send,
  serializer: WebsocketSerializer<Send, Receive> | undefined
): WebsocketData {
  if (serializer === undefined) {
    return data as WebsocketData;
  }

  return serializer.serialize(data as Send);
}

/**
 * Deserializes data on message-event, if a serializer is provided.
 * @param data the data to deserialize
 * @param serializer the serializer to use
 * @return the deserialized data
 */
export function deserializeIfNeeded<
  Send = WebsocketData,
  Receive = WebsocketData,
>(
  data: WebsocketData,
  serializer: WebsocketSerializer<Send, Receive> | undefined
): Receive {
  if (serializer === undefined) {
    return data as Receive;
  }

  return serializer.deserialize(data as WebsocketData);
}
