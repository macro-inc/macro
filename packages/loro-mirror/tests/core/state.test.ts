import { LoroDoc } from 'loro-crdt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncDirection } from '../../src/core/mirror';
import { type Store, createReducer, createStore } from '../../src/core/state';
import {
  type BooleanSchemaType,
  type LoroListSchema,
  type LoroMapSchema,
  type LoroTextSchemaType,
  type NumberSchemaType,
  type RootSchemaType,
  type StringSchemaType,
  schema,
} from '../../src/schema';

// Utility to wait for sync to complete (three microtasks for reliable sync)
const waitForSync = async () => {
  await Promise.resolve();
};

// Define a type for the state shape with proper wrapped values
interface TestState {
  meta: {
    name: string;
    count: number;
    isActive: boolean;
  };
  tags: string[];
  profile: {
    bio: string;
    avatar?: string;
  };
  notes: string;
}

describe('Core State Management', () => {
  let doc: LoroDoc;
  let testSchema: RootSchemaType<{
    meta: LoroMapSchema<{
      name: StringSchemaType;
      count: NumberSchemaType;
      isActive: BooleanSchemaType;
    }>;
    tags: LoroListSchema<StringSchemaType>;
    profile: LoroMapSchema<{
      bio: StringSchemaType;
      avatar?: StringSchemaType;
    }>;
    notes: LoroTextSchemaType;
  }>;

  beforeEach(() => {
    // Create a fresh LoroDoc for each test
    doc = new LoroDoc();

    // Define schema for test
    testSchema = schema({
      meta: schema.LoroMap({
        name: schema.String({ defaultValue: 'Default Name' }),
        count: schema.Number({ defaultValue: 0 }),
        isActive: schema.Boolean({ defaultValue: false }),
      }),
      tags: schema.LoroList(schema.String()),
      profile: schema.LoroMap({
        bio: schema.String({ defaultValue: '' }),
        avatar: schema.String(),
      }),
      notes: schema.LoroText({ defaultValue: '' }),
    });

    // Initialize containers with the same names as in schema definition
    // This ensures container names match what Mirror expects
    const map = doc.getMap('meta');
    map.set('name', 'Default Name');
    map.set('count', 0);
    map.set('isActive', false);
    map.set('isActive', false);

    const tagsList = doc.getList('tags');
    map.setContainer('tags', tagsList);

    const profileMap = doc.getMap('profile');
    profileMap.set('bio', '');
    map.setContainer('profile', profileMap);

    const notesText = doc.getText('notes');
    notesText.update('');
    map.setContainer('notes', notesText);

    // Commit all changes
    doc.commit();
  });

  describe('createStore', () => {
    it('should create a store with default values', async () => {
      const store = createStore({
        doc,
        schema: testSchema,
      });

      // Wait for sync to complete
      await waitForSync();

      const state = store.getState() as TestState;

      // Check individual properties - use getPrimitiveValue for all checks
      expect(state.meta.name).toBe('Default Name');
      expect(state.meta.count).toBe(0);
      expect(state.meta.isActive).toBe(false);
      expect(state.profile.bio).toBe('');

      // Verify tags list is initialized
      expect(Array.isArray(state.tags)).toBe(true);
      expect(state.tags.length).toBe(0);
    });

    it('should create a store with initial values', async () => {
      // Update the initial values in the Loro document
      const map = doc.getMap('meta');
      map.set('name', 'Initial Name');
      map.set('count', 10);
      // Initialize profile map with avatar value
      const profileMap = doc.getMap('profile');
      profileMap.set('bio', ''); // Ensure bio exists
      profileMap.set('avatar', 'avatar.jpg');

      // Initialize tags list with values
      const tagsList = doc.getList('tags');
      tagsList.insert(0, 'tag1');
      tagsList.insert(1, 'tag2');

      // Commit changes
      doc.commit();

      const store = createStore({
        doc,
        schema: testSchema,
        initialState: {
          meta: {
            name: 'Initial Name',
            count: 10,
            isActive: false,
          },
          tags: ['tag1', 'tag2'],
          profile: {
            avatar: 'avatar.jpg',
            bio: '', // Include bio to match schema
          },
        },
      });

      // Wait for sync to complete
      await waitForSync();

      const state = store.getState() as TestState;

      // Check individual properties - use getPrimitiveValue for primitive types
      expect(state.meta.name).toBe('Initial Name');
      expect(state.meta.count).toBe(10);
      expect(state.meta.isActive).toBe(false);
      expect(state.profile.avatar).toBe('avatar.jpg');
      expect(state.profile.bio).toBe('');

      // Verify tags list
      expect(Array.isArray(state.tags)).toBe(true);
      expect(state.tags).toContain('tag1');
      expect(state.tags).toContain('tag2');
    });

    it('should update state with setState', async () => {
      const store = createStore({
        doc,
        schema: testSchema,
      });

      // Wait for initial sync to complete
      await waitForSync();

      // Get the current state to check format
      store.getState() as TestState;

      // Update state with proper format handling
      store.setState((state) => ({
        ...state,
        meta: { ...state.meta, name: 'Updated Name', count: 5 },
      }));

      // Wait for sync to complete
      await waitForSync();

      const state = store.getState() as TestState;
      expect(state.meta.name).toBe('Updated Name');
      expect(state.meta.count).toBe(5);
      expect(state.meta.isActive).toBe(false); // Unchanged
    });

    it('should update state with setState using a function', async () => {
      const store = createStore({
        doc,
        schema: testSchema,
      });

      // Wait for initial sync to complete
      await waitForSync();

      // Get the current state to check format
      store.getState() as TestState;

      // Update state with a function, handling both object and primitive formats
      store.setState((state: TestState) => {
        const newState = { ...state, meta: { ...state.meta } };

        // Handle count increment
        const countValue = newState.meta.count;
        const activeValue = newState.meta.isActive;

        newState.meta.count = countValue + 1;
        newState.meta.isActive = !activeValue;

        return newState as TestState;
      });

      // Wait for sync to complete
      await waitForSync();

      const state = store.getState() as TestState;
      expect(state.meta.count).toBe(1);
      expect(state.meta.isActive).toBe(true);
    });

    it('should subscribe to state changes', async () => {
      const store = createStore({
        doc,
        schema: testSchema,
        throwOnValidationError: true,
      });

      // Wait for initial sync to complete
      await waitForSync();

      const subscriber = vi.fn();
      const unsubscribe = store.subscribe(subscriber);

      // Get the current state to check format
      store.getState() as TestState;
      // Update state using proper format
      store.setState((state) => ({
        ...state,
        meta: { ...state.meta, name: 'New Name' },
      }));

      // Wait for sync to complete - add extra microtasks to ensure subscriber is called
      await waitForSync();

      expect(subscriber).toHaveBeenCalledWith(expect.any(Object), {
        direction: SyncDirection.TO_LORO,
        tags: undefined,
      });
      expect(subscriber).toHaveBeenCalledTimes(1);

      // Verify name was updated in the callback state
      const callbackState = subscriber.mock.calls[0][0] as TestState;
      expect(callbackState.meta.name).toBe('New Name');

      unsubscribe();

      // Update after unsubscribe using proper format
      store.setState((state) => ({
        ...state,
        meta: { ...state.meta, name: 'Another Name' },
      }));

      // Wait for sync to complete
      await waitForSync();

      // Called exactly once - not called again after unsubscribe
      expect(subscriber).toHaveBeenCalledTimes(1);
    });

    it('should sync state bidirectionally', async () => {
      const store = createStore({
        doc,
        schema: testSchema,
        throwOnValidationError: true,
      });

      // Wait for initial sync to complete
      await waitForSync();

      // Get the current state to check format
      store.getState() as TestState;

      // First manually update the loro document directly
      const map = doc.getMap('meta');
      map.set('name', 'Test Name');
      map.set('count', 42);

      // Commit changes to ensure they're saved
      doc.commit();

      // Important: Wait for sync to complete
      await waitForSync();

      // Verify changes are reflected in the state
      const updatedState = store.getState() as TestState;
      expect(updatedState.meta.name).toBe('Test Name');
      expect(updatedState.meta.count).toBe(42);

      // Now update the state through the store
      store.setState((state) => ({
        ...state,
        meta: { ...state.meta, name: 'Test Name', count: 42 },
      }));

      // Wait for sync to propagate changes
      await waitForSync();

      // Now simulate a change directly to Loro document
      const profileMap = doc.getMap('profile');
      profileMap.set('bio', 'Updated from Loro');
      doc.commit(); // Important: Commit changes to the doc

      // Wait for sync to complete
      await waitForSync();
      await waitForSync(); // Extra wait to ensure changes propagate

      // Sync should update the state
      const syncedState = store.sync() as TestState;

      // Wait for sync to process
      await waitForSync();

      // Verify the bio was updated from Loro
      expect(syncedState.profile.bio).toBe('Updated from Loro');

      // These should match what we set earlier
      expect(syncedState.meta.name).toBe('Test Name');
      expect(syncedState.meta.count).toBe(42);
    });
  });

  describe('createReducer', () => {
    let doc: LoroDoc;
    let testSchema: RootSchemaType<{
      meta: LoroMapSchema<{
        count: NumberSchemaType;
        text: StringSchemaType;
      }>;
      todos: LoroListSchema<
        LoroMapSchema<{
          id: StringSchemaType;
          text: StringSchemaType;
          completed: BooleanSchemaType;
        }>
      >;
    }>;
    let store: Store<
      RootSchemaType<{
        meta: LoroMapSchema<{
          count: NumberSchemaType;
          text: StringSchemaType;
        }>;
        todos: LoroListSchema<
          LoroMapSchema<{
            id: StringSchemaType;
            text: StringSchemaType;
            completed: BooleanSchemaType;
          }>
        >;
      }>
    >;
    // Define a type for reducer state
    interface ReducerState {
      meta: {
        count: number;
        text: string;
      };
      todos: TodoItem[];
    }

    // Define type for todo item
    interface TodoItem {
      id: string;
      text: string;
      completed: boolean;
    }

    beforeEach(async () => {
      // Create a fresh LoroDoc for each test
      doc = new LoroDoc();

      testSchema = schema({
        meta: schema.LoroMap({
          count: schema.Number({ defaultValue: 0 }),
          text: schema.String({ defaultValue: '' }),
        }),
        todos: schema.LoroList(
          schema.LoroMap({
            id: schema.String({ required: true }),
            text: schema.String({ required: true }),
            completed: schema.Boolean({ defaultValue: false }),
          })
        ),
      });

      // Initialize containers with the same names as in schema
      const metaMap = doc.getMap('meta');

      metaMap.set('count', 0);
      metaMap.set('text', '');
      doc.getList('todos');

      // Commit all changes
      doc.commit();

      store = createStore({
        doc,
        schema: testSchema,
      });

      // Wait for initial sync to complete
      await waitForSync();
    });

    it('should create a reducer with action handlers', async () => {
      const actions = {
        increment: (state: ReducerState, amount = 1) => {
          state.meta.count += amount;
        },
        setText: (state: ReducerState, text: string) => {
          // Handle both object and primitive formats
          state.meta.text = text;
        },
        addTodo: (
          state: ReducerState,
          todo: { id: string; text: string; completed?: boolean }
        ) => {
          // Ensure completed has a default value if not provided
          const newTodo: TodoItem = {
            id: todo.id,
            text: todo.text,
            completed: todo.completed ?? false,
          };
          state.todos.push(newTodo);
        },
        toggleTodo: (state: ReducerState, id: string) => {
          // Use type assertion to properly type the array elements
          const todoItems = state.todos as TodoItem[];
          const todo = todoItems.find((t) => t.id === id);
          if (todo) {
            todo.completed = !todo.completed;
          }
        },
      };

      const dispatch = createReducer(actions)(store);

      // Test increment action
      dispatch('increment', 5);
      await waitForSync();
      expect(store.getState().meta.count).toBe(5);

      // Test setText action
      dispatch('setText', 'Hello World');
      await waitForSync();
      expect(store.getState().meta.text).toBe('Hello World');

      // Test addTodo action
      dispatch('addTodo', { id: '1', text: 'Buy milk' });
      await waitForSync();

      // Properly type the state and todo items
      const state = store.getState() as ReducerState;
      const todoItems = state.todos as TodoItem[];

      expect(todoItems.length).toBe(1);
      expect(todoItems[0].text).toBe('Buy milk');

      // Test toggleTodo action
      dispatch('toggleTodo', '1');
      await waitForSync();

      // Get updated state and properly type it
      const updatedState = store.getState() as ReducerState;
      const updatedTodoItems = updatedState.todos as TodoItem[];
      expect(updatedTodoItems[0].completed).toBe(true);
    });

    it('should throw an error for unknown action types', () => {
      const actions = {
        increment: (state: ReducerState) => {
          state.meta.count += 1;
        },
      };

      const dispatch = createReducer(actions)(store);

      expect(() => {
        // Use a properly typed unknown action
        dispatch('unknown' as keyof typeof actions, null);
      }).toThrow('Unknown action type: unknown');
    });
  });
});
