/**
 * State management functionality for Loro Mirror
 */
import { produce } from 'immer';
import type { LoroDoc } from 'loro-crdt';
import type { InferType, SchemaType } from '../schema';
import { Mirror, type UpdateMetadata } from './mirror';

/**
 * Options for creating a store
 */
export interface CreateStoreOptions<S extends SchemaType> {
  /**
   * The Loro document to sync with
   */
  doc: LoroDoc;

  /**
   * The schema definition for the state
   */
  schema: S;

  /**
   * Initial state (optional)
   */
  initialState?: Partial<InferType<S>>;

  /**
   * Whether to validate state updates against the schema
   * @default true
   */
  validateUpdates?: boolean;

  /**
   * Whether to throw errors on validation failures
   * @default false
   */
  throwOnValidationError?: boolean;

  /**
   * Debug mode - logs operations
   * @default false
   */
  debug?: boolean;
}

/**
 * Store API returned by createStore
 */
export interface Store<S extends SchemaType> {
  /**
   * Get current state
   */
  getState: () => InferType<S>;

  /**
   * Update state and sync to Loro
   */
  setState: (
    updater: ((state: InferType<S>) => InferType<S>) | Partial<InferType<S>>
  ) => void;

  /**
   * Subscribe to state changes
   */
  subscribe: (
    callback: (state: InferType<S>, metadata: UpdateMetadata) => void
  ) => () => void;

  /**
   * Force sync from Loro to application state
   */
  syncFromLoro: () => InferType<S>;

  /**
   * Force sync from application state to Loro
   */
  syncToLoro: () => void;

  /**
   * Full bidirectional sync
   */
  sync: () => InferType<S>;

  /**
   * Get the underlying Mirror instance
   */
  getMirror: () => Mirror<S>;
  getLoro: () => LoroDoc;
}

/**
 * Create a store that syncs state with Loro
 */
export function createStore<S extends SchemaType>(
  options: CreateStoreOptions<S>
): Store<S> {
  const mirror = new Mirror<S>({
    doc: options.doc,
    schema: options.schema,
    initialState: options.initialState,
    validateUpdates: options.validateUpdates,
    throwOnValidationError: options.throwOnValidationError ?? true,
    debug: options.debug,
  });

  return {
    getState: () => mirror.getState(),
    setState: (updater) => mirror.setState(updater),
    subscribe: (callback) => mirror.subscribe(callback),
    syncFromLoro: () => mirror.syncFromLoro(),
    syncToLoro: () => mirror.syncToLoro(),
    sync: () => mirror.sync(),
    getMirror: () => mirror,
    getLoro: () => options.doc,
  };
}

/**
 * Create an immer-based reducer function for a store
 */
export function createReducer<
  S extends SchemaType,
  A extends Record<string, any>,
>(
  actionHandlers: {
    [K in keyof A]: (state: InferType<S>, payload: A[K]) => void | InferType<S>;
  }
) {
  return (store: Store<S>) => {
    // Return a dispatch function that takes an action and payload
    return <K extends keyof A>(actionType: K, payload: A[K]) => {
      const handler = actionHandlers[actionType];
      if (!handler) {
        throw new Error(`Unknown action type: ${String(actionType)}`);
      }

      store.setState((state) => {
        // Use immer's produce to create a draft that can be mutated
        const result = produce(state, (draft: any) => {
          // Call the action handler with the draft state and payload
          return handler(draft as InferType<S>, payload) as InferType<S> | void;
        });

        // Cast the result to the correct type
        return result as unknown as InferType<S>;
      });
    };
  };
}
