# Loro Mirror

A TypeScript state management library that syncs application state with [loro-crdt](https://github.com/loro-dev/loro).

## Features

- 🔄 **Bidirectional Sync**: Seamlessly sync between application state and Loro CRDT
- 📊 **Schema Validation**: Type-safe schema system for validating state
- 🧩 **Composable Core**: Focused package for state management primitives
- 🔍 **Selective Updates**: Subscribe to specific parts of your state
- 🛠️ **Developer Friendly**: Familiar API inspired by popular state management libraries

## Packages

- [`@loro-mirror/core`](./packages/core): Core state management functionality

## Installation

### Core Package

```bash
npm install @loro-mirror/core loro-crdt
# or
yarn add @loro-mirror/core loro-crdt
# or
pnpm add @loro-mirror/core loro-crdt
```

## Quick Start

### Usage

```typescript
import { LoroDoc } from 'loro-crdt';
import { schema, createStore } from '@loro-mirror/core';

// Define your schema
const todoSchema = schema({
  todos: schema.LoroList(
    schema.LoroMap({
      id: schema.String({ required: true }),
      text: schema.String({ required: true }),
      completed: schema.Boolean({ defaultValue: false }),
    })
  ),
});

// Create a Loro document
const doc = new LoroDoc();

// Create a store
const store = createStore({
  doc,
  schema: todoSchema,
  initialState: { todos: [] },
});

// Update the state
store.setState((state) => {
  state.todos.push({
    id: Date.now().toString(),
    text: 'Learn Loro Mirror',
    completed: false,
  });
  return state;
});

// Subscribe to state changes
store.subscribe((state) => {
  console.log('State updated:', state);
});
```

## Documentation

For detailed documentation, see the core package README:

- [Core Documentation](./packages/core/README.md)

## License

MIT
