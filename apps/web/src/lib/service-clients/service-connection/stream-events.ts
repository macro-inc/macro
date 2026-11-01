import type { EntityData } from '@entity';
import {
  WebsocketConnectionState,
  WebsocketEvent,
} from '@macro-inc/collaboration/websocket';
import { type Accessor, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { StreamEvent } from './generated/schemas';
import { isStreamEntity, type StreamType } from './stream';
import { createConnectionWebsocketEffect, ws } from './websocket';

const [streamState, setStreamState] = createStore<Record<string, StreamEvent>>(
  {}
);
const subscribed = new Map<
  string,
  { type: keyof StreamType; consumers: number }
>();
const sent = new Set<string>();

function sendStreamSubscription(
  entity_id: string,
  entity_type: keyof StreamType
) {
  // Replay owns pending subscriptions; buffering would send them twice on open.
  if (ws.readyState !== WebsocketConnectionState.Open || sent.has(entity_id))
    return;
  if (ws.send({ type: 'stream_events', entity_id, entity_type }))
    sent.add(entity_id);
}

ws.addEventListener(WebsocketEvent.Open, () => {
  sent.clear();
  for (const [id, subscription] of subscribed)
    sendStreamSubscription(id, subscription.type);
});

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
  if (!isStreamEntity(entity_type)) return;
  const subscription = subscribed.get(entity_id) ?? {
    type: entity_type,
    consumers: 0,
  };
  subscription.consumers++;
  subscribed.set(entity_id, subscription);
  sendStreamSubscription(entity_id, entity_type);
  onCleanup(() => {
    if (--subscription.consumers === 0) subscribed.delete(entity_id);
  });
}
