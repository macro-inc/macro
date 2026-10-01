/**
 * Types for the schema definition system
 */

import type { ContainerType } from '../document';

/**
 * Options for schema definitions
 */
export interface SchemaOptions {
  /** Whether the field is required */
  required?: boolean;
  /** Default value for the field */
  defaultValue?: any;
  /** Description of the field */
  description?: string;
  /** Additional validation function */
  validate?: (value: any) => boolean | string;
  [key: string]: any;
}

/**
 * Base interface for all schema types
 */
export interface BaseSchemaType {
  type: string;
  options: SchemaOptions;
  getContainerType(): ContainerType | null;
}

/**
 * String schema type
 */
export interface StringSchemaType extends BaseSchemaType {
  type: 'string';
}

/**
 * Number schema type
 */
export interface NumberSchemaType extends BaseSchemaType {
  type: 'number';
}

/**
 * Boolean schema type
 */
export interface BooleanSchemaType extends BaseSchemaType {
  type: 'boolean';
}

/**
 * Ignored field schema type
 */
export interface IgnoreSchemaType extends BaseSchemaType {
  type: 'ignore';
}

/**
 * Automerge Map schema type
 */
export interface AutomergeMapSchema<T extends Record<string, SchemaType>>
  extends BaseSchemaType {
  type: 'automerge-map';
  definition: SchemaDefinition<T>;
}

/**
 * Automerge List schema type
 */
export interface AutomergeListSchema<T extends SchemaType>
  extends BaseSchemaType {
  type: 'automerge-list';
  itemSchema: T;
  idSelector?: (item: any) => string;
}

/**
 * Automerge Movable List schema type
 */
export interface AutomergeMovableListSchema<T extends SchemaType>
  extends BaseSchemaType {
  type: 'automerge-movable-list';
  itemSchema: T;
  idSelector?: (item: any) => string;
}

/**
 * Automerge Text schema type
 */
export interface AutomergeTextSchemaType extends BaseSchemaType {
  type: 'automerge-text';
}

/**
 * Root schema type
 */
export interface RootSchemaType<T extends Record<string, ContainerSchemaType>>
  extends BaseSchemaType {
  type: 'schema';
  definition: RootSchemaDefinition<T>;
}

/**
 * Union of all schema types
 */
export type SchemaType =
  | StringSchemaType
  | NumberSchemaType
  | BooleanSchemaType
  | IgnoreSchemaType
  | AutomergeMapSchema<Record<string, SchemaType>>
  | AutomergeListSchema<SchemaType>
  | AutomergeMovableListSchema<SchemaType>
  | AutomergeTextSchemaType
  | RootSchemaType<Record<string, ContainerSchemaType>>;

export type ContainerSchemaType =
  | AutomergeMapSchema<Record<string, SchemaType>>
  | AutomergeListSchema<SchemaType>
  | AutomergeMovableListSchema<SchemaType>
  | AutomergeTextSchemaType;

/**
 * Schema definition type
 */
export type RootSchemaDefinition<
  T extends Record<string, ContainerSchemaType>,
> = {
  [K in keyof T]: T[K];
};

/**
 * Schema definition type
 */
export type SchemaDefinition<T extends Record<string, SchemaType>> = {
  [K in keyof T]: T[K];
};

/**
 * Infer the JavaScript type from a schema type
 */
export type InferType<S extends SchemaType> = S extends StringSchemaType
  ? string
  : S extends NumberSchemaType
    ? number
    : S extends BooleanSchemaType
      ? boolean
      : S extends IgnoreSchemaType
        ? any
        : S extends AutomergeTextSchemaType
          ? string
          : S extends AutomergeMapSchema<infer M>
            ? { [K in keyof M]: InferType<M[K]> }
            : S extends AutomergeListSchema<infer I>
              ? Array<InferType<I>>
              : S extends AutomergeMovableListSchema<infer I>
                ? Array<InferType<I>>
                : S extends RootSchemaType<infer R>
                  ? { [K in keyof R]: InferType<R[K]> }
                  : never;

/**
 * Infer the JavaScript type from a schema definition
 */
export type InferSchemaType<T extends Record<string, SchemaType>> = {
  [K in keyof T]: InferType<T[K]>;
};
