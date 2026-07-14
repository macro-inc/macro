# WebSocket

Shared, type-safe WebSocket abstraction with reconnect, buffering, heartbeat,
serialization, and Solid lifecycle helpers. Import its public API through the
`@macro-inc/collaboration/websocket` export.

## Basic Usage

```typescript
import { JsonSerializer, WebsocketBuilder, WebsocketEvent } from '@macro-inc/collaboration/websocket';

const ws = new WebsocketBuilder('ws://localhost:5000')
  .withSerializer(new JsonSerializer<SendType, ReceiveType>())
  .build();

ws.addEventListener(WebsocketEvent.Message, (_socket, event) => {
  console.log('Received:', event.data);
});

ws.send({ type: 'hello' });
```

## Builder Pattern

```typescript
import { ExponentialBackoff, WebsocketBuilder } from '@macro-inc/collaboration/websocket';

const ws = new WebsocketBuilder('ws://localhost:5000')
  .withBackoff(new ExponentialBackoff(1_000, 5))
  .withHeartbeat({
    interval: 30_000,
    timeout: 5_000,
    pingMessage: 'ping',
    pongMessage: 'pong',
    maxMissedHeartbeats: 2,
  })
  .build();
```

## Reconnection

Configure retries with the builder:

```typescript
const ws = new WebsocketBuilder(url)
  .withMaxRetries(10)
  .withBackoff(new ExponentialBackoff(1_000, 5))
  .build();
```

## Serialization

Built-in serializers for common formats:

```typescript
import { BebopSerializer, JsonSerializer } from '@macro-inc/collaboration/websocket';

// JSON
new WebsocketBuilder(url)
  .withSerializer(new JsonSerializer())
  .build();

// Bebop (binary)
new WebsocketBuilder(url)
  .withSerializer(new BebopSerializer(encoder, decoder))
  .build();
```

## SolidJS Integration

Reactive effects for message handling:

```typescript
import { createSocketEffect, createWebsocketEventEffect } from '@macro-inc/collaboration/websocket';

// Listen to all messages
createSocketEffect(ws, (data) => {
  console.log('Received:', data);
});

// Type-based filtering
createWebsocketEventEffect(ws, 'chat', (msg: ChatMessage) => {
  addToChat(msg);
});
```

## Connection State

Track connection lifecycle:

```typescript
import { WebsocketEvent } from '@macro-inc/collaboration/websocket';

ws.addEventListener(WebsocketEvent.Open, () => console.log('Connected'));
ws.addEventListener(WebsocketEvent.Close, () => console.log('Disconnected'));
ws.addEventListener(WebsocketEvent.retry, (_socket, event) =>
  console.log('Retrying:', event.detail)
);
ws.addEventListener(WebsocketEvent.Reconnect, () =>
  console.log('Reconnected')
);

// Or use reactive state
import { createWebsocketStateSignal } from '@macro-inc/collaboration/websocket';
const state = createWebsocketStateSignal(ws);
```

## API Reference

**Core**
- `Websocket<Send, Receive>` - Main WebSocket wrapper
- `WebsocketBuilder` - Fluent builder interface

**Backoff Strategies**
- `ExponentialBackoff(base, maxExponent?)` - Exponential growth
- `LinearBackoff(initial, increment, max?)` - Linear growth
- `ConstantBackoff(delay)` - Fixed delay

**Serializers**
- `JsonSerializer<Send, Receive>()` - JSON serialization
- `BebopSerializer<Send, Receive>(encoder, decoder)` - Binary serialization

**Queues** (for message buffering)
- `ArrayQueue<T>()` - Unbounded array-based queue
- `RingQueue<T>(capacity)` - Fixed-size circular buffer

**SolidJS Effects**
- `createSocketEffect(ws, handler)` - Listen to all messages
- `createWebsocketEventEffect(ws, type, handler)` - Filter by message type
- `createWebsocketStateSignal(ws)` - Reactive connection state

**Utils**
- `untilMessage<T>(ws, predicate)` - Promise that resolves on matching message
