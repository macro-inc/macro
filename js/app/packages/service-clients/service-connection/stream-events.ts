import type { Accessor } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { StreamEvent } from './generated/schemas';
import { isStreamEntity } from './stream';
import { createConnectionWebsocketEffect, ws } from './websocket';
import type { EntityData } from '@entity';

const [streamState, setStreamState] = createStore<Record<string, StreamEvent>>(
  {}
);
const subscribed = new Set<string>();

createConnectionWebsocketEffect((data) => {
  if (data.type !== 'stream_event') return;
  try {
    const event = JSON.parse(data.data) as StreamEvent;
    setStreamState(event.entity_id, event);
  } catch {
    return;
  }
});

export function getStreamState(
  entity_id: string
): Accessor<StreamEvent | undefined> {
  return () => streamState[entity_id];
}

export function subscribeToStreamState(
  entity_id: string,
  entity_type: EntityData['type']
) {
  if (!isStreamEntity(entity_type) || subscribed.has(entity_id)) return;
  subscribed.add(entity_id);
  ws.send({
    type: 'stream_events',
    entity_id,
    entity_type: entity_type,
  });
}
