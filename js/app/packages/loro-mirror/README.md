# Loro Mirror

A TypeScript state management library that syncs application state with [loro-crdt](https://github.com/loro-dev/loro).

## Features

- 🔄 **Bidirectional Sync**: Seamlessly sync between application state and Loro CRDT
- 📊 **Schema Validation**: Type-safe schema system for validating state
- 🧩 **Modular Design**: Core package for state management, React package for React integration
- 🔍 **Selective Updates**: Subscribe to specific parts of your state
- 🛠️ **Developer Friendly**: Familiar API inspired by popular state management libraries
- 📱 **React Integration**: Hooks and context providers for React applications

## Packages

- [`@loro-mirror/core`](./packages/core): Core state management functionality
- [`@loro-mirror/react`](./packages/react): React integration with hooks and context

## Installation

### Core Package

```bash
npm install @loro-mirror/core loro-crdt
# or
yarn add @loro-mirror/core loro-crdt
# or
pnpm add @loro-mirror/core loro-crdt
```

### React Package

```bash
npm install @loro-mirror/react @loro-mirror/core loro-crdt
# or
yarn add @loro-mirror/react @loro-mirror/core loro-crdt
# or
pnpm add @loro-mirror/react @loro-mirror/core loro-crdt
```

## Quick Start

### Core Usage

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

### React Usage

```tsx
import React, { useMemo } from 'react';
import { LoroDoc } from 'loro-crdt';
import { schema } from '@loro-mirror/core';
import { createLoroContext } from '@loro-mirror/react';

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

// Create a context
const {
  LoroProvider,
  useLoroState,
  useLoroSelector,
  useLoroAction,
} = createLoroContext(todoSchema);

// Root component
function App() {
  const doc = useMemo(() => new LoroDoc(), []);
  
  return (
    <LoroProvider doc={doc} initialState={{ todos: [] }}>
      <TodoList />
      <AddTodoForm />
    </LoroProvider>
  );
}

// Todo list component
function TodoList() {
  const todos = useLoroSelector(state => state.todos);
  
  return (
    <ul>
      {todos.map(todo => (
        <li key={todo.id}>
          <input
            type="checkbox"
            checked={todo.completed}
            onChange={() => toggleTodo(todo.id)}
          />
          <span>{todo.text}</span>
        </li>
      ))}
    </ul>
  );
}

// Add todo form component
function AddTodoForm() {
  const [text, setText] = useState('');
  
  const addTodo = useLoroAction((state) => {
    state.todos.push({
      id: Date.now().toString(),
      text: text.trim(),
      completed: false,
    });
  }, [text]);
  
  const handleSubmit = (e) => {
    e.preventDefault();
    if (text.trim()) {
      addTodo();
      setText('');
    }
  };
  
  return (
    <form onSubmit={handleSubmit}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What needs to be done?"
      />
      <button type="submit">Add Todo</button>
    </form>
  );
}
```

## Documentation

For detailed documentation, see the README files in each package:

- [Core Documentation](./packages/core/README.md)
- [React Documentation](./packages/react/README.md)

## License

MIT
