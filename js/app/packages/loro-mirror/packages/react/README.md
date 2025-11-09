# Loro Mirror React

React integration for Loro Mirror - a state management library with Loro CRDT synchronization.

## Installation

```bash
npm install @loro-mirror/react @loro-mirror/core loro-crdt
# or
yarn add @loro-mirror/react @loro-mirror/core loro-crdt
# or
pnpm add @loro-mirror/react @loro-mirror/core loro-crdt
```

## Usage

### Basic Usage with Hooks

```tsx
import React, { useMemo } from 'react';
import { LoroDoc } from 'loro-crdt';
import { schema } from '@loro-mirror/core';
import { useLoroStore } from '@loro-mirror/react';

// Define your schema
const todoSchema = schema({
  todos: schema.LoroList(
    schema.LoroMap({
      id: schema.String({ required: true }),
      text: schema.String({ required: true }),
      completed: schema.Boolean({ defaultValue: false }),
    }),
    // ID selector for the list items
    (item) => item.id
  ),
  filter: schema.String({ defaultValue: 'all' }),
});

function TodoApp() {
  // Create a Loro document
  const doc = useMemo(() => new LoroDoc(), []);
  
  // Create a store
  const { state, setState } = useLoroStore({
    doc,
    schema: todoSchema,
    initialState: { todos: [], filter: 'all' },
  });
  
  // Add a new todo
  const addTodo = (text: string) => {
    setState((state) => {
      state.todos.push({
        id: Date.now().toString(),
        text,
        completed: false,
      });
      return state;
    });
  };
  
  // Rest of your component...
}
```

### Using Context Provider

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
  useLoroContext,
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
  // Subscribe only to the todos array
  const todos = useLoroSelector(state => state.todos);
  
  return (
    <ul>
      {todos.map(todo => (
        <TodoItem key={todo.id} todo={todo} />
      ))}
    </ul>
  );
}

// Todo item component
function TodoItem({ todo }) {
  const toggleTodo = useLoroAction(state => {
    const todoIndex = state.todos.findIndex(t => t.id === todo.id);
    if (todoIndex !== -1) {
      state.todos[todoIndex].completed = !state.todos[todoIndex].completed;
    }
  });
  
  return (
    <li>
      <input
        type="checkbox"
        checked={todo.completed}
        onChange={toggleTodo}
      />
      <span>{todo.text}</span>
    </li>
  );
}
```

## API Reference

### `useLoroStore`

Creates and manages a Loro Mirror store.

```tsx
const { state, setState, sync, syncFromLoro, syncToLoro, store } = useLoroStore({
  doc,
  schema,
  initialState,
  validateUpdates,
  throwOnValidationError,
  debug,
});
```

### `useLoroValue`

Subscribes to a specific value from a Loro Mirror store.

```tsx
const todos = useLoroValue(store, state => state.todos);
```

### `useLoroCallback`

Creates a callback that updates a Loro Mirror store.

```tsx
const addTodo = useLoroCallback(
  store,
  (state, text) => {
    state.todos.push({
      id: Date.now().toString(),
      text,
      completed: false,
    });
  },
  [/* dependencies */]
);

// Usage
addTodo('New todo');
```

### `createLoroContext`

Creates a context provider and hooks for a Loro Mirror store.

```tsx
const {
  LoroContext,
  LoroProvider,
  useLoroContext,
  useLoroState,
  useLoroSelector,
  useLoroAction,
} = createLoroContext(schema);
```

#### `LoroProvider`

Provider component for the Loro Mirror context.

```tsx
<LoroProvider
  doc={loroDoc}
  initialState={initialState}
  validateUpdates={true}
  throwOnValidationError={false}
  debug={false}
>
  {children}
</LoroProvider>
```

#### `useLoroContext`

Hook to access the Loro Mirror store from context.

```tsx
const store = useLoroContext();
```

#### `useLoroState`

Hook to access and update the full state.

```tsx
const [state, setState] = useLoroState();
```

#### `useLoroSelector`

Hook to select a specific value from the state.

```tsx
const todos = useLoroSelector(state => state.todos);
```

#### `useLoroAction`

Hook to create an action that updates the state.

```tsx
const addTodo = useLoroAction(
  (state, text) => {
    state.todos.push({
      id: Date.now().toString(),
      text,
      completed: false,
    });
  },
  [/* dependencies */]
);

// Usage
addTodo('New todo');
```

## License

MIT 
