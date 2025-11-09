/**
 * Types for the schema definition system
 */

import { ContainerType } from "loro-crdt";

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
    type: "string";
}

/**
 * Number schema type
 */
export interface NumberSchemaType extends BaseSchemaType {
    type: "number";
}

/**
 * Boolean schema type
 */
export interface BooleanSchemaType extends BaseSchemaType {
    type: "boolean";
}

/**
 * Ignored field schema type
 */
export interface IgnoreSchemaType extends BaseSchemaType {
    type: "ignore";
}

/**
 * Loro Map schema type
 */
export interface LoroMapSchema<T extends Record<string, SchemaType>>
    extends BaseSchemaType {
    type: "loro-map";
    definition: SchemaDefinition<T>;
}

/**
 * Loro List schema type
 */
export interface LoroListSchema<T extends SchemaType> extends BaseSchemaType {
    type: "loro-list";
    itemSchema: T;
    idSelector?: (item: any) => string;
}

/**
 * Loro Movable List schema type
 */
export interface LoroMovableListSchema<T extends SchemaType> extends BaseSchemaType {
    type: "loro-movable-list";
    itemSchema: T;
    idSelector?: (item: any) => string;
}

/**
 * Loro Text schema type
 */
export interface LoroTextSchemaType extends BaseSchemaType {
    type: "loro-text";
}

/**
 * Root schema type
 */
export interface RootSchemaType<T extends Record<string, ContainerSchemaType>>
    extends BaseSchemaType {
    type: "schema";
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
    | LoroMapSchema<Record<string, SchemaType>>
    | LoroListSchema<SchemaType>
    | LoroMovableListSchema<SchemaType>
    | LoroTextSchemaType
    | RootSchemaType<Record<string, ContainerSchemaType>>;

export type ContainerSchemaType =
    | LoroMapSchema<Record<string, SchemaType>>
    | LoroListSchema<SchemaType>
    | LoroMovableListSchema<SchemaType>
    | LoroTextSchemaType;

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
    : S extends NumberSchemaType ? number
    : S extends BooleanSchemaType ? boolean
    : S extends IgnoreSchemaType ? any
    : S extends LoroTextSchemaType ? string
    : S extends LoroMapSchema<infer M> ? { [K in keyof M]: InferType<M[K]> }
    : S extends LoroListSchema<infer I> ? Array<InferType<I>>
    : S extends LoroMovableListSchema<infer I> ? Array<InferType<I>>
    : S extends RootSchemaType<infer R> ? { [K in keyof R]: InferType<R[K]> }
    : never;

/**
 * Infer the JavaScript type from a schema definition
 */
export type InferSchemaType<T extends Record<string, SchemaType>> = {
    [K in keyof T]: InferType<T[K]>;
};
