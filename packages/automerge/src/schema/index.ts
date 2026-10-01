/**
 * Schema definition system for Automerge Mirror
 *
 * This module provides utilities to define schemas that map between JavaScript types and Automerge CRDT types.
 */
import type {
  AutomergeListSchema,
  AutomergeMapSchema,
  AutomergeMovableListSchema,
  AutomergeTextSchemaType,
  ContainerSchemaType,
  RootSchemaDefinition,
  RootSchemaType,
  SchemaDefinition,
  SchemaOptions,
  SchemaType,
} from './types';

export * from './types';

/**
 * Create a schema definition
 */
export function schema<T extends Record<string, ContainerSchemaType>>(
  definition: RootSchemaDefinition<T>,
  options?: SchemaOptions
): RootSchemaType<T> {
  return {
    type: 'schema' as const,
    definition,
    options: options || {},
    getContainerType() {
      return 'Map';
    },
  };
}

/**
 * Define a string field
 */
schema.String = (options?: SchemaOptions) => ({
  type: 'string' as const,
  options: options || {},
  getContainerType() {
    return null; // Primitive type, no container
  },
});

/**
 * Define a number field
 */
schema.Number = (options?: SchemaOptions) => ({
  type: 'number' as const,
  options: options || {},
  getContainerType() {
    return null; // Primitive type, no container
  },
});

/**
 * Define a boolean field
 */
schema.Boolean = (options?: SchemaOptions) => ({
  type: 'boolean' as const,
  options: options || {},
  getContainerType() {
    return null; // Primitive type, no container
  },
});

/**
 * Define a field to be ignored (not synced with Automerge)
 */
schema.Ignore = (options?: SchemaOptions) => ({
  type: 'ignore' as const,
  options: options || {},
  getContainerType() {
    return null;
  },
});

/**
 * Define a Automerge map
 */
schema.AutomergeMap = <T extends Record<string, SchemaType>>(
  definition: SchemaDefinition<T>,
  options?: SchemaOptions
): AutomergeMapSchema<T> => ({
  type: 'automerge-map' as const,
  definition,
  options: options || {},
  getContainerType() {
    return 'Map';
  },
});

/**
 * Define a Automerge list
 */
schema.AutomergeList = <T extends SchemaType>(
  itemSchema: T,
  idSelector?: (item: any) => string,
  options?: SchemaOptions
): AutomergeListSchema<T> => ({
  type: 'automerge-list' as const,
  itemSchema,
  idSelector,
  options: options || {},
  getContainerType() {
    return 'List';
  },
});

schema.AutomergeMovableList = <T extends SchemaType>(
  itemSchema: T,
  idSelector: (item: any) => string,
  options?: SchemaOptions
): AutomergeMovableListSchema<T> => ({
  type: 'automerge-movable-list' as const,
  itemSchema,
  idSelector,
  options: options || {},
  getContainerType() {
    return 'MovableList';
  },
});

/**
 * Define a Automerge text field
 */
schema.AutomergeText = (options?: SchemaOptions): AutomergeTextSchemaType => ({
  type: 'automerge-text' as const,
  options: options || {},
  getContainerType() {
    return 'Text';
  },
});
