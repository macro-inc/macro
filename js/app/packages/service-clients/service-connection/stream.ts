import type { ChatStream } from '@service-cognition/generated/schemas';
import type { Accessor, Setter } from 'solid-js';
import { createSignal } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { match } from 'ts-pattern';
import { createConnectionWebsocketEffect } from './websocket';
// entities that support streaming
export type StreamType = {
  chat: ChatStream;
};

export type StreamId = {
  entity_type: keyof StreamType;
  entity_id: string;
  // matches chat message id
  stream_id: string;
};

export type StreamItem<K extends keyof StreamType> = {
  id: StreamId;
  payload: StreamType[K];
};

export interface Stream<K extends keyof StreamType> {
  id: Accessor<StreamId | undefined>;
  data: Accessor<StreamType[K][]>;
  isDone: Accessor<boolean>;
}

type StreamController<K extends keyof StreamType> = {
  stream: Stream<K>;
  setData: Setter<StreamType[K][]>;
  setDone: () => void;
  id: StreamId;
};

function newController<K extends keyof StreamType>(
  id: StreamId
): StreamController<K> {
  const [data, setData] = createSignal<StreamType[K][]>([]);
  const [isDone, setIsDone] = createSignal(false);

  return {
    stream: {
      id: () => id,
      data,
      isDone,
    },
    id,
    setData,
    setDone: () => setIsDone(true),
  };
}

type StreamWithType = {
  stream: StreamController<keyof StreamType>;
  type: keyof StreamType;
};

// internal record of all streams
// map<entity_id, map<stream_id, StreamWithType>>;
const [streams, setStreams] = createStore<
  Record<string, Record<string, StreamWithType>>
>({});

export function clearStream(entity_id: string) {
  setStreams(
    produce((s) => {
      delete s[entity_id];
    })
  );
}

function streamIsDone(
  kind: keyof StreamType,
  item: StreamType[keyof StreamType]
): boolean {
  const isDone = match({ kind, item })
    .with({ kind: 'chat' }, ({ item }) => item.type === 'stream_end')
    .exhaustive();
  return isDone;
}

function addStream(
  entity_id: string,
  stream_id: string,
  entry: StreamWithType
) {
  setStreams(
    produce((s) => {
      if (!s[entity_id]) s[entity_id] = {};
      s[entity_id][stream_id] = entry;
    })
  );
}

// new message!
createConnectionWebsocketEffect((message) => {
  // not a stream
  if (message.type !== 'stream') return;

  let item: StreamItem<keyof StreamType>;
  try {
    item = JSON.parse(message.data);
  } catch {
    console.error('unparsable stream payload', message);
    return;
  }
  // if this is not the 1st item proces new item / add to stream
  if (
    streams[item.id.entity_id] &&
    streams[item.id.entity_id][item.id.stream_id]
  ) {
    const stream = streams[item.id.entity_id][item.id.stream_id];
    if (streamIsDone(item.id.entity_type, item.payload)) {
      stream.stream.setDone();
    } else {
      stream.stream.setData((p) => [...p, item.payload]);
    }
  }
  // is 1st item
  else {
    // new stream
    const newStream = newController(item.id);
    // process item
    if (streamIsDone(item.id.entity_type, item.payload)) {
      newStream.setDone();
    } else {
      newStream.setData([item.payload]);
    }
    addStream(item.id.entity_id, item.id.stream_id, {
      stream: newStream,
      type: item.id.entity_type,
    });
  }
});

// create a new stream or retreive existing stream
// if a new stream is created it represents the expectation that items will arive to that stream
export function subscribe<K extends keyof StreamType>(
  entity_type: K,
  entity_id: string,
  stream_id: string
): Stream<K> | undefined {
  if (streams[entity_id]?.[stream_id]) {
    if (streams[entity_id][stream_id].type !== entity_type) {
      console.error('unexpected stream type');
      return;
    }
    return streams[entity_id][stream_id].stream.stream as Stream<K>;
  } else {
    const controller = newController({
      entity_id,
      entity_type,
      stream_id,
    });
    addStream(entity_id, stream_id, {
      stream: controller,
      type: entity_type,
    });
    return controller.stream as Stream<K>;
  }
}

/** Reactive accessor for all streams on an entity. */
export function getEntityStreams<K extends keyof StreamType>(
  entity_type: K,
  entity_id: string
): Accessor<Stream<K>[]> {
  return () => {
    const entityStreams = streams[entity_id];
    if (!entityStreams) return [];
    return Object.values(entityStreams)
      .filter((s) => s.type === entity_type)
      .map((s) => s.stream.stream as Stream<K>);
  };
}
