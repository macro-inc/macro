# @macro/websocket

Type-safe WebSocket abstraction with auto-reconnect, buffering, and heartbeat support.

## Basic Usage

```typescript
import { Websocket } from 'websocket';

const ws = new Websocket<SendType, ReceiveType>('ws://localhost:5000');

ws.addEventListener('message', (event) => {
  console.log('Received:', event.detail);
});

ws.send({ type: 'hello' });
```

## Builder Pattern

```typescript
import { WebsocketBuilder, ExponentialBackoff, JsonSerializer } from 'websocket';

const ws = new WebsocketBuilder('ws://localhost:5000')
  .withBackoff(new ExponentialBackoff(1000, 30000))
  .withSerializer(new JsonSerializer())
  .withHeartbeat({ interval: 30000, timeout: 5000 })
  .build();
```

## Reconnection

Configurable via `retryOptions`:

```typescript
const ws = new Websocket(url, {
  retryOptions: {
    maxRetries: 10,
    backoff: new ExponentialBackoff(1000, 30000)
  }
});
```

## Serialization

Built-in serializers for common formats:

```typescript
import { JsonSerializer, BebopSerializer } from 'websocket';

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
import { createSocketEffect, createWebsocketEventEffect } from 'websocket';

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
ws.addEventListener('open', () => console.log('Connected'));
ws.addEventListener('close', () => console.log('Disconnected'));
ws.addEventListener('retry', (e) => console.log('Retrying:', e.detail));
ws.addEventListener('reconnect', (e) => console.log('Reconnected:', e.detail));

// Or use reactive state
import { createWebsocketStateSignal } from 'websocket';
const [state] = createWebsocketStateSignal(ws);
```

## API Reference

**Core**
- `Websocket<Send, Receive>` - Main WebSocket wrapper
- `WebsocketBuilder` - Fluent builder interface

**Backoff Strategies**
- `ExponentialBackoff(initial, max)` - Exponential growth
- `LinearBackoff(initial, increment)` - Linear growth
- `ConstantBackoff(delay)` - Fixed delay

**Serializers**
- `JsonSerializer<T>()` - JSON serialization
- `BebopSerializer<T>(encoder, decoder)` - Binary serialization

**Queues** (for message buffering)
- `ArrayQueue<T>()` - Unbounded array-based queue
- `RingQueue<T>(capacity)` - Fixed-size circular buffer

**SolidJS Effects**
- `createSocketEffect(ws, handler)` - Listen to all messages
- `createWebsocketEventEffect(ws, type, handler)` - Filter by message type
- `createWebsocketStateSignal(ws)` - Reactive connection state

**Utils**
- `untilMessage<T>(ws, predicate)` - Promise that resolves on matching message
