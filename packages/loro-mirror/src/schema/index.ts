/**
 * Schema definition system for Loro Mirror
 *
 * This module provides utilities to define schemas that map between JavaScript types and Loro CRDT types.
 */
import type {
  ContainerSchemaType,
  InferType,
  LoroListSchema,
  LoroMapSchema,
  LoroMovableListSchema,
  LoroTextSchemaType,
  LoroTreeSchema,
  RootSchemaDefinition,
  RootSchemaType,
  SchemaDefinition,
  SchemaOptions,
  SchemaType,
  ValueSchemaType,
} from './types';

export * from './types';
export * from './validators';

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
 * Define a field to be ignored (not synced with Loro)
 */
schema.Ignore = (options?: SchemaOptions) => ({
  type: 'ignore' as const,
  options: options || {},
  getContainerType() {
    return null;
  },
});

/**
 * Define a Loro map
 */
schema.LoroMap = <T extends Record<string, SchemaType>>(
  definition: SchemaDefinition<T>,
  options?: SchemaOptions
): LoroMapSchema<T> => ({
  type: 'loro-map' as const,
  definition,
  options: options || {},
  getContainerType() {
    return 'Map';
  },
});

/**
 * Define a Loro list
 */
schema.LoroList = <T extends SchemaType>(
  itemSchema: T,
  idSelector?: (item: any) => string,
  options?: SchemaOptions
): LoroListSchema<T> => ({
  type: 'loro-list' as const,
  itemSchema,
  idSelector,
  options: options || {},
  getContainerType() {
    return 'List';
  },
});

schema.LoroMovableList = <T extends SchemaType>(
  itemSchema: T,
  idSelector: (item: any) => string,
  options?: SchemaOptions
): LoroMovableListSchema<T> => ({
  type: 'loro-movable-list' as const,
  itemSchema,
  idSelector,
  options: options || {},
  getContainerType() {
    return 'MovableList';
  },
});

/**
 * Define a Loro text field
 */
schema.LoroText = (options?: SchemaOptions): LoroTextSchemaType => ({
  type: 'loro-text' as const,
  options: options || {},
  getContainerType() {
    return 'Text';
  },
});

/** Declare an atomic JSON register with a runtime type guard. */
schema.Value = <T>(
  accepts: (value: unknown) => value is T,
  options?: SchemaOptions
): ValueSchemaType<T> => ({
  type: 'value',
  accepts,
  options: options || {},
  getContainerType: () => null,
});

/** Ordered native tree; moving a JS node preserves its CRDT identity. */
schema.LoroTree = <T extends LoroMapSchema<Record<string, SchemaType>>>(
  nodeSchema: T,
  idSelector: (data: InferType<T>) => string,
  options?: SchemaOptions
): LoroTreeSchema<T> => ({
  type: 'loro-tree',
  nodeSchema,
  idSelector,
  options: options || {},
  getContainerType: () => 'Tree',
});
