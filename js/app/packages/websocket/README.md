
```typescript
// Simple WebSocket with auto-cleanup
const ws = createWS('ws://localhost:5000');

// With reconnection
const ws = createReconnectingWS('ws://localhost:5000', [], {
  delay: 3000,    // 3s between reconnects
  retries: 10     // stop after 10 attempts
});
```

## Composing Features

Stack wrappers from inside out:

```typescript
const ws = makeAuthenticatedWS(      // 4. Auth handling
  makeFocusTrackingWS(               // 3. Reconnect on focus
    makeHeartbeatWS(                 // 2. Connection health
      makeJsonWS(                    // 1. JSON serialization
        createReconnectingWS(url)    // 0. Base reconnection
      )
    )
  )
);

// Or use the sensible defaults
const ws = makeJsonWS(
  createSensibleWS('ws://localhost:5000')
);
```

## Message Serialization

```typescript
// JSON
const ws = makeJsonWS<SendType, ReceiveType>(createWS(url));
ws.send({ type: 'chat', text: 'Hello' }); // auto-serialized

// Zod validation
const ws = makeZodWS(createWS(url), SendSchema, ReceiveSchema);

// Binary (Bebop)
const ws = makeBebopWS(createWS(url), MessageType, ServerMessageType);
```

## Reactive Effects

```typescript
// Listen to all messages
createWebsocketEffect(ws, (data) => {
  console.log('Received:', data);
});

// Type-based filtering
createWebsocketEventEffect(ws, 'chat', (msg: ChatMessage) => {
  addToChat(msg);
});

// Custom selectors
createWebsocketSelectEffect(ws,
  (data): data is CriticalEvent => data.priority === 'high',
  (event) => handleCritical(event)
);

// Block effects for special contexts
createBlockWebsocketEffect(ws, (data) => {
  updateBlockState(data);
});
```

## Selector Helpers

```typescript
// Single type
messageTypeSelector('chat')

// Multiple types
multiTypeSelector('chat', 'status', 'typing')

// Property matching
propertySelector('userId', currentUser.id)
```

## Quick Reference

**Base Functions**
- `makeWS` / `createWS` - Basic WebSocket
- `makeReconnectingWS` / `createReconnectingWS` - Auto-reconnect
- `createWSState` - Reactive connection state

**Wrappers** (compose these!)
- `makeHeartbeatWS` - Ping/pong health checks
- `makeFocusTrackingWS` - Reconnect on tab focus
- `makeAuthenticatedWS` - Handle auth changes
- `makeJsonWS` - JSON serialization
- `makeZodWS` - Type validation
- `makeBebopWS` - Binary protocol

**Effects**
- `createWebsocketEffect` - Listen to all messages
- `createWebsocketEventEffect` - Listen by type field
- `createWebsocketSelectEffect` - Custom selector
- `createBlock*` variants - For block contexts
