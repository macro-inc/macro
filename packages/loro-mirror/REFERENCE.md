# Loro Mirror Core

A bidirectional state synchronization layer between application state and Loro
CRDT.

## Features

- **Schema-based State Management**: Define your data schema with strong typing
- **Bidirectional Sync**: Changes in application state are reflected in Loro,
  and vice versa
- **Efficient Updates**: Smart diffing and patching for minimal operations
- **Container Management**: Automatic handling of Loro containers

## Installation

```bash
bun add @loro-mirror/core loro-crdt
```

## Usage

```typescript
import { Mirror, schema } from "@loro-mirror/core";
import { LoroDoc } from "loro-crdt";

// Define your schema
const todoSchema = schema({
  todos: schema.LoroList(
    schema.LoroMap({
      id: schema.String({ required: true }),
      text: schema.String({ required: true }),
      completed: schema.Boolean({ defaultValue: false }),
    }),
    // ID selector function helps with efficient list updates
    (todo) => todo.id,
  ),
  settings: schema.LoroMap({
    darkMode: schema.Boolean({ defaultValue: false }),
    showCompleted: schema.Boolean({ defaultValue: true }),
  }),
});

// Create the mirror
const loro = new LoroDoc();
const mirror = new Mirror({
  doc: loro,
  schema: todoSchema,
});

// Get the current state
const state = mirror.getState();

// Update the state (immutably)
mirror.setState({
  ...state,
  todos: [
    ...state.todos,
    { id: "3", text: "New task", completed: false },
  ],
});

// Subscribe to changes
const unsubscribe = mirror.subscribe((state, direction) => {
  console.log("State updated:", state);
  console.log("Update direction:", direction);
});

// Clean up when done
mirror.dispose();
```

## Efficient List Updates

The Mirror supports efficient list updates through ID-based item tracking, which
is particularly useful for lists of objects with stable identifiers.

### How It Works

1. **ID Selectors**: When defining a list schema, you can provide an
   `idSelector` function that extracts a unique ID from each item:

   ```typescript
   schema.LoroList(
     schema.LoroMap({
       id: schema.String(),
       // other fields...
     }),
     (item) => item.id, // The ID selector function
   );
   ```

2. **Smart Diffing**: When updating the state, Mirror identifies:
   - Items that need to be added (exist in new state but not in old state)
   - Items that need to be removed (exist in old state but not in new state)
   - Items that need to be updated (exist in both states but with different
     values)

3. **Minimal Operations**: Rather than clearing and rebuilding the entire list,
   Mirror performs the minimal set of operations needed:
   - Removes only items that should be deleted
   - Updates only items that have changed
   - Adds only new items

### Benefits

- **Performance**: Significantly fewer operations for large lists
- **Preserves Item Identity**: Maintains item identity across updates
- **Network Efficiency**: Reduces the number of operations that need to be
  synchronized in collaborative scenarios

### Without ID Selectors

If no ID selector is provided, Mirror falls back to a position-based update
strategy:

- Items are compared by index
- Changes at each index position are detected and applied
- This is less efficient for reordering operations but still aims to minimize
  changes

## Advanced Usage

### Todo List Example with ID Selectors

Here's a practical example showing how to use the Mirror with a todo list
application:

```typescript
import { Mirror, schema } from "@loro-mirror/core";
import { LoroDoc } from "loro-crdt";

// Define the schema
const todoAppSchema = schema({
  todos: schema.LoroList(
    schema.LoroMap({
      id: schema.String({ required: true }),
      text: schema.String({ required: true }),
      completed: schema.Boolean({ defaultValue: false }),
      priority: schema.Number({ defaultValue: 0 }),
      createdAt: schema.Number({ required: true }),
    }),
    // The ID selector helps Mirror efficiently track and update items
    (todo) => todo.id,
  ),
  filter: schema.String({ defaultValue: "all" }),
  sorting: schema.String({ defaultValue: "createdAt" }),
});

const mirror = new Mirror({
  doc: new LoroDoc(),
  schema: todoAppSchema,
});

const addTodo = (text: string) => {
  const state = mirror.getState();

  mirror.setState({
    ...state,
    todos: [
      ...state.todos,
      {
        id: Date.now().toString(),
        text,
        completed: false,
        priority: 0,
        createdAt: Date.now(),
      },
    ],
  });
};

const toggleTodo = (id: string) => {
  const state = mirror.getState();

  mirror.setState({
    ...state,
    todos: state.todos.map((todo) =>
      todo.id === id ? { ...todo, completed: !todo.completed } : todo
    ),
  });
};

const removeTodo = (id: string) => {
  const state = mirror.getState();

  mirror.setState({
    ...state,
    todos: state.todos.filter((todo) => todo.id !== id),
  });
};

const setSorting = (sortField: "createdAt" | "priority") => {
  const state = mirror.getState();
  const sortedTodos = [...state.todos].sort((a, b) => {
    if (sortField === "priority") {
      return b.priority - a.priority;
    }
    return a.createdAt - b.createdAt;
  });

  mirror.setState({
    ...state,
    sorting: sortField,
    todos: sortedTodos,
  });
};

const unsubscribe = mirror.subscribe((state) => {
  console.log("Todo state changed", state);
});

addTodo("Ship the core package");
setSorting("priority");
unsubscribe();
```

In this example:

1. The `idSelector` function is used to track todos by their ID
2. When toggling a todo's state or changing the sort order, Mirror efficiently
   identifies which items changed
3. When reordering items (by sorting), the Mirror applies efficient move
   operations instead of deleting and recreating items
4. Nested data structures can be updated independently without affecting other
   parts of the state

### Performance Considerations

For large lists, using an `idSelector` can significantly improve performance by:

- Reducing the number of operations sent to Loro
- Minimizing network traffic in collaborative scenarios
- Preserving item identity, which helps UI layers avoid unnecessary work

For more examples and detailed API documentation, see the
[API Reference](#api-reference).

## Schema System

Loro Mirror includes a powerful schema system for defining the structure of your
state.

### Basic Types

```typescript
import { schema } from "@loro-mirror/core";

const userSchema = schema({
  // Basic types
  name: schema.String({ required: true }),
  age: schema.Number({ defaultValue: 0 }),
  isActive: schema.Boolean({ defaultValue: true }),

  // Fields to ignore (not synced with Loro)
  localOnly: schema.Ignore(),

  // Loro specific types
  bio: schema.LoroText(), // Rich text

  // Nested objects
  profile: schema.LoroMap({
    avatar: schema.String(),
    website: schema.String(),
  }),

  // Arrays
  tags: schema.LoroList(
    schema.String(),
    // Optional ID selector for list items
    (item) => item,
  ),

  // Complex nested structures
  posts: schema.LoroList(
    schema.LoroMap({
      id: schema.String({ required: true }),
      title: schema.String({ required: true }),
      content: schema.LoroText(),
      published: schema.Boolean({ defaultValue: false }),
      tags: schema.LoroList(schema.String()),
    }),
    // ID selector for list items
    (post) => post.id,
  ),
});
```

### Schema Options

Each schema type accepts options:

```typescript
schema.String({
  // Whether the field is required
  required: true,

  // Default value
  defaultValue: "",

  // Description
  description: "User name",

  // Custom validation function
  validate: (value) => {
    if (value.length < 3) {
      return "Name must be at least 3 characters";
    }
    return true;
  },
});
```

## API Reference

### `schema`

Function to create a schema definition.

```typescript
const mySchema = schema({
  // Schema definition
});
```

### Schema Types

- `schema.String(options?)` - String type
- `schema.Number(options?)` - Number type
- `schema.Boolean(options?)` - Boolean type
- `schema.Ignore(options?)` - Field to ignore (not synced with Loro)
- `schema.LoroText(options?)` - Loro rich text
- `schema.LoroMap(definition, options?)` - Loro map (object)
- `schema.LoroList(itemSchema, idSelector?, options?)` - Loro list (array)

### `createStore`

Creates a store with the given options.

```typescript
const store = createStore({
  doc: loroDoc,
  schema: mySchema,
  initialState: initialState,
  validateUpdates: true,
  throwOnValidationError: false,
  debug: false,
});
```

### Store API

- `getState()` - Get the current state
- `setState(updater)` - Update the state
- `subscribe(callback)` - Subscribe to state changes
- `syncFromLoro()` - Sync from Loro to application state
- `syncToLoro()` - Sync from application state to Loro
- `sync()` - Full bidirectional sync
- `getMirror()` - Get the underlying Mirror instance

### `createReducer`

Creates a reducer function for handling actions.

```typescript
const todoReducer = createReducer({
  addTodo: (state, payload: { text: string }) => {
    state.todos.push({
      id: Date.now().toString(),
      text: payload.text,
      completed: false,
    });
  },
  toggleTodo: (state, payload: { id: string }) => {
    const todoIndex = state.todos.findIndex((todo) => todo.id === payload.id);
    if (todoIndex !== -1) {
      state.todos[todoIndex].completed = !state.todos[todoIndex].completed;
    }
  },
  // More actions...
});

// Usage with a store
const dispatch = todoReducer(store);
dispatch.addTodo({ text: "Learn Loro Mirror" });
dispatch.toggleTodo({ id: "123" });
```

## License

MIT

## Native ordered trees

```typescript
const nodeSchema = schema.LoroMap({
  id: schema.String({ required: true }),
  title: schema.String({ required: true }),
});
const canvasSchema = schema({
  scene: schema.LoroTree(nodeSchema, data => data.id),
});
const mirror = new Mirror({ doc: loro, schema: canvasSchema });
mirror.setState({ scene: [
  { data: { id: 'a', title: 'First' }, children: [
    { data: { id: 'child', title: 'Child' }, children: [] },
  ] },
  { data: { id: 'b', title: 'Second' }, children: [] },
] });
mirror.setState(state => {
  const [child] = state.scene[0].children.splice(0, 1);
  state.scene[1].children.push(child);
});
```

The forest projects an actual `LoroTree`, with each node's `data` stored in its
native `LoroMap`. The application ID selector must return a nonempty, globally
unique ID within the tree. Moves between parents or sibling positions preserve
native node and data-map identities. Changing an application ID represents
removing one node and creating another. Delete a subtree by removing its node;
extracting a surviving child in the same proposal moves it before deletion.
Data maps can contain nested schema containers, including other trees.

`setState` recipes use Immer drafts and may mutate and return the draft, return
an immutable replacement, or return nothing after mutation. Published state is
frozen. Invalid trees (duplicate IDs, cycles, malformed data or non-JSON values)
are rejected before any writes, even with `validateUpdates: false`. Validation outside trees can be disabled; tree structure, node data and
native-operation safety remain mandatory.
One proposal becomes one commit and undo step. One native batch produces one
notification; `UpdateMetadata.changedRoots` identifies affected root fields for
native batches. Explicit full sync notifications omit that field.

`schema.Value(typeGuard, options?)` declares a JSON value stored atomically in a
single LWW register, including objects and arrays. It never infers nested CRDT
containers. Use it for values whose fields must win together, such as a geometry
and coordinate-frame tuple. Use Map/Text schemas when independent merging is
wanted. Undefined optional fields are omitted; atomic JSON cannot contain
undefined, non-finite numbers or cycles. Explicit null must pass the supplied
guard, including for required nullable values; required rejects absent values.

Root schema option `{ allowUnknown: true }` permits a scene Mirror to coexist
with unrelated host metadata roots in the same document. Partial updates retain
those fields. The caller still owns its document lifecycle and must dispose the
Mirror before freeing the document. Opening a persisted native tree only reads
it; it does not rewrite or convert existing node data.
