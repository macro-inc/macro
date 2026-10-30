/**
 * Mirror core functionality for bidirectional sync between app state and Loro CRDT
 */
import { type Draft, produce } from 'immer';
import {
  type Container,
  type ContainerID,
  type ContainerType,
  type LoroDoc,
  type LoroEventBatch,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  LoroTree,
} from 'loro-crdt';
import {
  assertTree,
  type ContainerSchemaType,
  getDefaultValue,
  type InferType,
  isContainerSchema,
  isListLikeSchema,
  isLoroTreeSchema,
  type LoroListSchema,
  type LoroMapSchema,
  type RootSchemaType,
  type SchemaType,
  validateSchema,
} from '../schema';
import { diffContainer } from './diff';
import { ContainerRegistry } from './registry';
import { readContainer, readDocument, updateTree } from './tree';
import { validateProposedTrees } from './tree-validation';
import {
  getRootContainerByType,
  inferContainerTypeFromValue,
  isObject,
  isValueOfContainerType,
  schemaToContainerType,
  tryInferContainerType,
} from './utils';

/**
 * Sync direction for handling updates
 */
export enum SyncDirection {
  /**
   * Changes coming from Loro to application state
   */
  FROM_LORO = 'FROM_LORO',

  /**
   * Changes going from application state to Loro
   */
  TO_LORO = 'TO_LORO',

  /**
   * Initial sync or manual sync operations
   */
  BIDIRECTIONAL = 'BIDIRECTIONAL',
}

/**
 * Configuration options for the Mirror
 */
export interface MirrorOptions<S extends SchemaType> {
  /**
   * The Loro document to sync with
   */
  doc: LoroDoc;

  /**
   * The schema definition for the state
   */
  schema?: S;

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

  /**
   * Default values for new containers
   */
  inferOptions?: InferContainerOptions;
}

export type InferContainerOptions = {
  defaultLoroText?: boolean;
  defaultMovableList?: boolean;
};

export type Change<K extends string | number = string | number> =
  | {
      container: ContainerID | '';
      key: K;
      value: any;
      kind: 'insert' | 'delete' | 'insert-container';
      childContainerType?: ContainerType;
    }
  | {
      container: ContainerID;
      key: number;
      value: any;
      kind: 'move';
      fromIndex: number;
      toIndex: number;
      childContainerType?: ContainerType;
    };

/**
 * Options for setState and sync operations
 */
export interface SetStateOptions {
  /**
   * Tags to attach to this state update
   * Tags can be used for tracking the source of changes or grouping related changes
   */
  tags?: string[] | string;
}

/**
 * Additional metadata for state updates
 */
export interface UpdateMetadata {
  /**
   * Direction of the sync operation
   */
  direction: SyncDirection;

  /**
   * Tags associated with this update, if any
   */
  tags?: string[];

  /** Root fields touched by a native batch; absent for explicit full syncs. */
  changedRoots?: string[];
}

/**
 * Callback type for subscribers
 */
export type SubscriberCallback<T> = (
  state: T,
  metadata: UpdateMetadata
) => void;

/**
 * Mirror class that provides bidirectional sync between application state and Loro
 */
export class Mirror<S extends SchemaType> {
  private doc: LoroDoc;
  private schema?: S;
  private state: InferType<S>;
  private subscribers: Set<SubscriberCallback<InferType<S>>> = new Set();
  private syncing: boolean = false;
  private options: MirrorOptions<S>;

  /** Root `doc.subscribe` listener. Must be dropped before `doc.free()`. */
  private docUnsubscribe?: () => void;
  private disposed = false;

  private containerRegistry: ContainerRegistry;

  getContainerIds(): ContainerID[] {
    return this.containerRegistry.ids();
  }

  /**
   * Creates a new Mirror instance
   */
  constructor(options: MirrorOptions<S>) {
    this.doc = options.doc;
    this.containerRegistry = new ContainerRegistry(options.doc);
    this.schema = options.schema;

    // Set default options
    this.options = {
      doc: options.doc,
      schema: options.schema,
      initialState: options.initialState || {},
      validateUpdates: options.validateUpdates !== false,
      throwOnValidationError: options.throwOnValidationError || false,
      debug: options.debug || false,
      inferOptions: options.inferOptions || {},
    };

    // Initialize state with defaults and initial state
    this.state = {
      ...(this.schema ? getDefaultValue(this.schema!) : {}),
      ...this.options.initialState,
    } as InferType<S>;

    // Initialize Loro containers
    this.initializeContainers();

    // The root subscription covers nested containers too. Subscribing to each
    // container would rebuild the full document and notify once per changed
    // container during undo/redo instead of once per batch.
    this.docUnsubscribe = this.doc.subscribe(this.handleLoroEvent);
  }

  /**
   * Initialize containers based on schema
   */
  private initializeContainers() {
    if (this.schema && this.schema.type !== 'schema') {
      throw new Error('Root schema must be of type "schema"');
    }

    // Get the initial state of the doc
    const currentDocState = readDocument(this.doc, this.schema);

    // Update the state with the doc's current state
    const newState = produce<InferType<S>>((draft) => {
      Object.assign(draft, currentDocState);
    })(this.state);

    this.state = newState;

    // Register root containers
    if (this.schema && this.schema.type === 'schema') {
      const rootSchema = this.schema as RootSchemaType<
        Record<string, ContainerSchemaType>
      >;
      for (const key in rootSchema.definition) {
        if (Object.hasOwn(rootSchema.definition, key)) {
          const fieldSchema = rootSchema.definition[key]!;

          if (
            [
              'loro-map',
              'loro-list',
              'loro-text',
              'loro-movable-list',
              'loro-tree',
            ].includes(fieldSchema.type)
          ) {
            const containerType = fieldSchema.getContainerType()!;
            const container = getRootContainerByType(
              this.doc,
              key,
              containerType
            );
            this.containerRegistry.register(container.id, fieldSchema);
          }
        }
      }
    }
  }

  /**
   * Handle events from the LoroDoc
   */
  private handleLoroEvent = (event: LoroEventBatch) => {
    if (this.disposed || this.syncing) return;
    if (event.origin === 'to-loro') return;

    this.syncing = true;
    try {
      // Get the current state of the doc
      const currentDocState = readDocument(this.doc, this.schema);

      // Update the state with the current doc state
      const newState = produce<InferType<S>>((draft) => {
        Object.assign(draft, currentDocState);
      })(this.state);

      this.state = newState;

      // Notify subscribers of the update
      this.notifySubscribers(SyncDirection.FROM_LORO, undefined, [
        ...new Set(
          event.events
            .map((change) => change.path[0])
            .filter((root): root is string => typeof root === 'string')
        ),
      ]);
    } finally {
      this.containerRegistry.onBatch(event);
      this.syncing = false;
    }
  };

  /**
   * Update Loro based on state changes
   */
  private updateLoro(newState: InferType<S>) {
    if (this.syncing) return;

    this.syncing = true;
    try {
      validateProposedTrees(this.schema, newState);
      // Find the differences between current Loro state and new state
      const currentDocState = this.state;
      if (this.options.debug) {
        console.log(
          'currentDocState:',
          JSON.stringify(currentDocState, null, 2)
        );
        console.log('newState:', JSON.stringify(newState, null, 2));
      }

      const changes = diffContainer(
        this.doc,
        currentDocState,
        newState,
        '',
        this.schema,
        this.options?.inferOptions
      );

      if (this.options.debug) {
        console.log('changes:', JSON.stringify(changes, null, 2));
      }
      // Apply the changes to the Loro document
      this.applyChangesToLoro(changes);

      // Log the doc state after changes
      if (this.options.debug) {
        console.log(
          'Doc state after changes:',
          JSON.stringify(this.doc.toJSON(), null, 2)
        );
      }
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Apply a set of changes to the Loro document
   */
  private applyChangesToLoro(changes: Change[], commit = true) {
    // Group changes by container for batch processing
    const changesByContainer = new Map<ContainerID | '', Change[]>();

    for (const change of changes) {
      if (!changesByContainer.has(change.container)) {
        changesByContainer.set(change.container, []);
      }
      changesByContainer.get(change.container)!.push(change);
    }

    // Process changes by container
    for (const [
      containerId,
      containerChanges,
    ] of changesByContainer.entries()) {
      if (containerId === '') {
        // Handle root level changes
        this.applyRootChanges(containerChanges);
      } else {
        // Handle container-specific changes
        const container = this.doc.getContainerById(containerId as ContainerID);
        if (container) {
          this.applyContainerChanges(container, containerChanges);
        } else {
          throw new Error(
            `Container not found for ID: ${containerId}.
                        This is likely due to a stale reference or a synchronization issue.`
          );
        }
      }
    }
    if (commit) this.doc.commit({ origin: 'to-loro' });
  }

  /**
   * Update root-level fields
   */
  private applyRootChanges(changes: Change[]) {
    for (const { key, value } of changes) {
      const keyStr = key.toString();

      const fieldSchema = (this.schema as RootSchemaType<any>)?.definition?.[
        keyStr
      ];
      const type =
        fieldSchema?.type ||
        inferContainerTypeFromValue(value, this.options?.inferOptions);
      let container: Container | null = null;

      // Create or get the container based on the schema type
      if (type === 'loro-map') {
        container = this.doc.getMap(keyStr);
      } else if (type === 'loro-list') {
        container = this.doc.getList(keyStr);
      } else if (type === 'loro-text') {
        container = this.doc.getText(keyStr);
      } else if (type === 'loro-tree') {
        container = this.doc.getTree(keyStr);
      } else if (type === 'loro-movable-list') {
        container = this.doc.getMovableList(keyStr);
      } else {
        throw new Error();
      }

      this.containerRegistry.set(container.id, fieldSchema);

      // Apply direct changes to the container
      this.updateTopLevelContainer(container, value);
    }
  }

  /**
   * Apply multiple changes to a container
   */
  private applyContainerChanges(container: Container, changes: Change[]) {
    // Apply changes in bulk by container type
    switch (container.kind()) {
      case 'Tree':
        for (const change of changes)
          this.updateTreeContainer(container, change.value);
        break;
      case 'Map': {
        const map = container as LoroMap;

        for (const { key, value, kind } of changes) {
          if (key === '') {
            continue; // Skip empty key
          }

          if (kind === 'insert') {
            map.set(key as string, value);
          } else if (kind === 'insert-container') {
            const schema = this.containerRegistry.childContainer(
              container.id,
              key
            );
            this.insertContainerIntoMap(map, schema, key as string, value);
          } else if (kind === 'delete') {
            map.delete(key as string);
          } else {
            throw new Error(`Unsupported change kind for map: ${kind}`);
          }
        }
        break;
      }
      case 'List': {
        const list = container as LoroList;
        // Process other changes (add/remove/replace)
        for (const { key, value, kind } of changes) {
          if (typeof key !== 'number') {
            throw new Error(`Invalid list index: ${key}`);
          }

          const index = key;
          if (index < 0) {
            console.warn(`Invalid list index: ${index}`);
            continue;
          }

          if (kind === 'delete') {
            list.delete(index, 1);
          } else if (kind === 'insert') {
            list.insert(index, value);
          } else if (kind === 'insert-container') {
            const schema = this.containerRegistry.childContainer(
              container.id,
              key
            );
            this.insertContainerIntoList(list, schema, index, value);
          } else {
            throw new Error(`Unsupported change kind for list: ${kind}`);
          }
        }
        break;
      }
      case 'MovableList': {
        const list = container as LoroMovableList;

        for (const change of changes) {
          const { key, value, kind } = change;
          if (typeof key !== 'number') {
            throw new Error(`Invalid list index: ${key}`);
          }

          const index = key;
          if (index < 0) {
            console.warn(`Invalid list index: ${index}`);
            continue;
          }

          if (kind === 'delete') {
            list.delete(index, 1);
          } else if (kind === 'insert') {
            list.insert(index, value);
          } else if (kind === 'insert-container') {
            const schema = this.containerRegistry.childContainer(
              container.id,
              key
            );
            this.insertContainerIntoList(list, schema, index, value);
          } else if (kind === 'move') {
            const fromIndex = change.fromIndex;
            const toIndex = change.toIndex;
            list.move(fromIndex, toIndex);
          }
        }

        break;
      }
      case 'Text': {
        const text = container as LoroText;
        // Text containers only support direct value updates
        for (const { key, value } of changes) {
          if (typeof value === 'string') {
            text.update(value);
          } else {
            console.warn(
              `Invalid Text change. Only 'value' property can be updated`,
              key,
              value
            );
          }
        }
        break;
      }
      default:
        console.warn(`Unsupported container type: ${container.kind()}`);
    }
  }

  /**
   * Update a top-level container directly with a new value
   */
  private updateTopLevelContainer(container: Container, value: any) {
    const kind = container.kind();

    switch (kind) {
      case 'Tree':
        this.updateTreeContainer(container, value);
        break;
      case 'Text':
        this.updateTextContainer(container as LoroText, value);
        break;
      case 'List':
        this.updateListContainer(container as LoroList, value);
        break;
      case 'Map':
        this.updateMapContainer(container as LoroMap, value);
        break;
      case 'MovableList':
        this.updateListContainer(container as LoroMovableList, value);
        break;
      default:
        throw new Error(
          `Unknown container kind for top-level update: ${kind}.
                    This is likely a programming error or unsupported container type.`
        );
    }
  }

  /**
   * Update a Text container
   */
  private updateTextContainer(text: LoroText, value: any) {
    if (typeof value !== 'string') {
      throw new Error('Text value must be a string');
    }
    text.update(value);
  }

  /**
   * Update a List container
   */
  private updateListContainer(
    list: LoroList | LoroMovableList,
    value: ArrayLike<unknown>
  ) {
    if (!Array.isArray(value)) throw new Error('List value must be an array');
    const schema = this.containerRegistry.get(list.id);
    if (schema && !isListLikeSchema(schema))
      throw new Error('List schema is required');
    this.applyChangesToLoro(
      diffContainer(
        this.doc,
        readContainer(list, schema),
        value,
        list.id,
        schema,
        this.options.inferOptions
      ),
      false
    );
  }

  /**
   * Subscribe to state changes
   */
  subscribe(callback: SubscriberCallback<InferType<S>>): () => void {
    this.subscribers.add(callback);

    // Return unsubscribe function
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Notify all subscribers of state change
   * @param direction The direction of the sync operation
   * @param tags Optional tags associated with this update
   */
  private notifySubscribers(
    direction: SyncDirection,
    tags?: string[],
    changedRoots?: string[]
  ) {
    const metadata: UpdateMetadata = {
      direction,
      tags,
      changedRoots,
    };

    for (const subscriber of this.subscribers) {
      subscriber(this.state, metadata);
    }
  }

  /**
   * Sync application state from Loro (one way)
   */
  syncFromLoro(): InferType<S> {
    if (this.syncing) return this.state;

    this.syncing = true;
    try {
      // Get the current state from the document
      const docState = readDocument(this.doc, this.schema);

      // Update the application state
      const newState = produce<InferType<S>>((draft) => {
        Object.assign(draft, docState);
      })(this.state);

      this.state = newState;

      this.notifySubscribers(SyncDirection.FROM_LORO);
    } finally {
      this.syncing = false;
    }

    return this.state;
  }

  /**
   * Sync Loro from application state (one way)
   */
  syncToLoro() {
    if (this.syncing) return;

    this.syncing = true;
    try {
      // Update Loro based on current state
      this.updateLoro(this.state);

      this.notifySubscribers(SyncDirection.TO_LORO);
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Full bidirectional sync
   */
  sync() {
    if (this.syncing) return this.state;

    // First sync from Loro to get latest state
    this.syncFromLoro();

    // Then sync back to Loro
    this.syncToLoro();

    return this.state;
  }

  /**
   * Clean up resources
   */
  dispose() {
    // Drop the doc listener before the owner calls `doc.free()`. Freeing a
    // doc with an open transaction commits it from `Drop`, after the JS
    // pointer is already zero, and this listener would call back into it.
    this.disposed = true;
    this.docUnsubscribe?.();
    this.docUnsubscribe = undefined;

    this.subscribers.clear();
  }

  /**
   * Attaches a detached container to a map
   *
   * If the schema is provided, the container will be registered with the schema
   */
  private insertContainerIntoMap(
    map: LoroMap,
    schema: ContainerSchemaType | undefined,
    key: string,
    value: any
  ) {
    const [detachedContainer, containerType] = this.createContainerFromSchema(
      schema,
      value
    );
    const insertedContainer = map.setContainer(key, detachedContainer);

    if (!insertedContainer) {
      throw new Error('Failed to insert container into map');
    }

    this.containerRegistry.register(insertedContainer.id, schema);

    this.initializeContainer(insertedContainer, containerType, schema, value);
  }

  /**
   * Once a container has been created, and attached to its parent
   *
   * We initialize the inner vaues using the schema that we previously registered.
   */
  private initializeContainer(
    container: Container,
    containerType: ContainerType,
    schema: ContainerSchemaType | undefined,
    value: any
  ) {
    if (containerType === 'Map') {
      const map = container as LoroMap;

      // Map has no inner values
      if (!isObject(value)) {
        return map;
      }

      // Populate the map with values
      for (const [key, val] of Object.entries(value)) {
        const fieldSchema = (schema as LoroMapSchema<any> | undefined)
          ?.definition[key];

        const isFieldContainer = isContainerSchema(fieldSchema);

        if (
          isFieldContainer &&
          isValueOfContainerType(schemaToContainerType(fieldSchema), val)
        ) {
          this.insertContainerIntoMap(map, fieldSchema, key, val);
        } else {
          // Default to simple set
          map.set(key, val);
        }
      }

      return map;
    } else if (containerType === 'List' || containerType === 'MovableList') {
      // Generate a unique ID for the list
      const list = container as LoroList;
      if (!Array.isArray(value)) {
        return list;
      }

      const itemSchema = (schema as LoroListSchema<any> | undefined)
        ?.itemSchema;

      const isListItemContainer = isContainerSchema(itemSchema);

      for (let i = 0; i < value.length; i++) {
        const item = value[i];

        if (
          isListItemContainer &&
          isValueOfContainerType(schemaToContainerType(itemSchema), item)
        ) {
          this.insertContainerIntoList(list, itemSchema, i, item);
        } else {
          // Default to simple insert
          list.insert(i, item);
        }
      }

      return list;
    } else if (containerType === 'Tree') {
      this.updateTreeContainer(container, value);
      return container;
    } else if (containerType === 'Text') {
      // Generate a unique ID for the text
      const text = container as LoroText;

      // Set the text content
      if (typeof value === 'string') {
        text.update(value);
      }

      return text;
    } else {
      throw new Error(`Unknown schema type: ${containerType}`);
    }
  }

  /**
   * Create a new container based on a given schema.
   *
   * If the schema is undefined, we infer the container type from the value.
   */
  private createContainerFromSchema(
    schema: ContainerSchemaType | undefined,
    value: any
  ): [Container, ContainerType] {
    const containerType = schema
      ? schemaToContainerType(schema)
      : tryInferContainerType(value, this.options?.inferOptions);

    switch (containerType) {
      case 'Map':
        return [new LoroMap(), 'Map'];
      case 'List':
        return [new LoroList(), 'List'];
      case 'MovableList':
        return [new LoroMovableList(), 'MovableList'];
      case 'Text':
        return [new LoroText(), 'Text'];
      case 'Tree':
        return [new LoroTree(), 'Tree'];
      default:
        throw new Error(`Unknown schema type: ${containerType}`);
    }
  }

  /**
   * Attaches a detached container to a list
   *
   * If the schema is provided, the container will be registered with the schema
   */
  private insertContainerIntoList(
    list: LoroList | LoroMovableList,
    schema: ContainerSchemaType | undefined,
    index: number,
    value: any
  ) {
    const [detachedContainer, containerType] = this.createContainerFromSchema(
      schema,
      value
    );
    let insertedContainer: Container | undefined;

    if (index === undefined) {
      insertedContainer = list.pushContainer(detachedContainer);
    } else {
      insertedContainer = list.insertContainer(index, detachedContainer);
    }

    if (!insertedContainer) {
      throw new Error('Failed to insert container into list');
    }

    this.containerRegistry.register(insertedContainer.id, schema);

    this.initializeContainer(insertedContainer, containerType, schema, value);
  }

  /**
   * Update a Map container
   */
  private updateMapContainer(map: LoroMap, value: any) {
    // Replace entire map
    if (isObject(value)) {
      // Find the schema for this container
      const schema = this.containerRegistry.get(map.id);
      if (!schema || schema.type !== 'loro-map') {
        if (this.options.debug) {
          console.warn(`No valid schema found for map: ${map.id}`);
        }
        return;
      }

      // Get current keys
      const currentKeys = new Set(map.keys());

      // Process each field in the new value
      for (const [key, val] of Object.entries(value)) {
        this.updateMapEntry(map, key, val, schema);
        currentKeys.delete(key);
      }

      // Delete keys that are no longer present
      for (const key of currentKeys) {
        map.delete(key);
      }
    } else {
      throw new Error('Map value must be an object');
    }
  }

  /**
   * Helper to update a single entry in a map
   */
  private updateMapEntry(
    map: LoroMap,
    key: string,
    value: any,
    schema: SchemaType | null
  ) {
    // Check if this field should be a container according to schema
    if (schema && schema.type === 'loro-map' && schema.definition) {
      const fieldSchema = schema.definition[key];
      if (fieldSchema) {
        const isContainer = isContainerSchema(fieldSchema);

        if (isContainer && typeof value === 'object' && value !== null) {
          this.insertContainerIntoMap(map, fieldSchema, key, value);
          return;
        }
      }
    }

    // Default to simple set
    map.set(key, value);
  }

  private updateTreeContainer(container: Container, value: unknown) {
    const schema = this.containerRegistry.get(container.id);
    if (
      !(container instanceof LoroTree) ||
      !schema ||
      !isLoroTreeSchema(schema)
    )
      throw new Error('Tree schema is required');
    assertTree(schema, value);
    updateTree(
      container,
      schema,
      readContainer(container, schema),
      value,
      (map, before, next, nodeSchema) => {
        this.containerRegistry.set(map.id, schema.nodeSchema);
        this.applyChangesToLoro(
          diffContainer(
            this.doc,
            before,
            next,
            map.id,
            nodeSchema,
            this.options.inferOptions
          ),
          false
        );
      }
    );
    this.containerRegistry.register(container.id, schema);
  }

  /**
   * Get current state
   */
  getState(): InferType<S> {
    return this.state;
  }

  /**
   * Update state and propagate changes to Loro
   * @param updater Function or object to update state
   * @param options Optional settings including tags
   */
  setState(
    updater:
      | ((state: Draft<InferType<S>>) => InferType<S> | void)
      | Partial<InferType<S>>,
    options?: SetStateOptions
  ) {
    if (this.syncing) return; // Prevent recursive updates

    // Calculate new state
    const newState = produce<InferType<S>>((draft) => {
      if (typeof updater === 'function') return updater(draft);
      Object.assign(draft, updater);
    })(this.state);

    // Validate state if needed
    if (this.options.validateUpdates) {
      const validation = this.schema && validateSchema(this.schema, newState);
      if (validation && !validation.valid) {
        const errorMessage = `State validation failed: ${validation.errors?.join(
          ', '
        )}`;
        throw new Error(errorMessage);
      }
    }

    // Extract tags for this update
    const tags = options?.tags
      ? Array.isArray(options.tags)
        ? options.tags
        : [options.tags]
      : undefined;

    // Update Loro based on new state
    this.updateLoro(newState);

    // Update the in-memory state
    this.state = newState;

    // Notify subscribers
    this.notifySubscribers(SyncDirection.TO_LORO, tags);
  }
}
