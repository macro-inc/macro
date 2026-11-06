import { isObject } from '../core/utils';
import { isJsonValue } from './json';
/**
 * Validators for schema definitions
 */
import type {
  BaseSchemaType,
  ContainerSchemaType,
  InferType,
  LoroListSchema,
  LoroMapSchema,
  LoroMovableListSchema,
  LoroTextSchemaType,
  LoroTreeSchema,
  RootSchemaType,
  SchemaType,
  TreeNode,
} from './types';

/**
 * Type guard for LoroMapSchema
 */
export function isLoroMapSchema<T extends Record<string, SchemaType>>(
  schema: SchemaType
): schema is LoroMapSchema<T> {
  return (schema as BaseSchemaType).type === 'loro-map';
}

/**
 * Type guard for LoroListSchema
 */
export function isLoroListSchema<T extends SchemaType>(
  schema: SchemaType
): schema is LoroListSchema<T> {
  return (schema as BaseSchemaType).type === 'loro-list';
}

export function isListLikeSchema<T extends SchemaType>(
  schema: SchemaType
): schema is LoroListSchema<T> | LoroMovableListSchema<T> {
  return isLoroListSchema(schema) || isLoroMovableListSchema(schema);
}

export function isLoroMovableListSchema<T extends SchemaType>(
  schema: SchemaType
): schema is LoroMovableListSchema<T> {
  return (schema as BaseSchemaType).type === 'loro-movable-list';
}

/**
 * Type guard for RootSchemaType
 */
export function isRootSchemaType<T extends Record<string, ContainerSchemaType>>(
  schema: SchemaType
): schema is RootSchemaType<T> {
  return (schema as BaseSchemaType).type === 'schema';
}

/**
 * Type guard for LoroTextSchemaType
 */
export function isLoroTextSchema(
  schema: SchemaType
): schema is LoroTextSchemaType {
  return (schema as BaseSchemaType).type === 'loro-text';
}

export function isLoroTreeSchema(
  schema: SchemaType
): schema is LoroTreeSchema<LoroMapSchema<Record<string, SchemaType>>> {
  return schema.type === 'loro-tree';
}

/** Validate and narrow values read from an untyped CRDT container. */
export function assertSchemaValue<S extends SchemaType>(
  schema: S,
  value: unknown
): asserts value is InferType<S> {
  const result = validateSchema(schema, value);
  if (!result.valid)
    throw new Error(`Invalid shared value: ${result.errors?.join(', ')}`);
}

/**
 * Check if a schema is for a Loro container
 */
export function isContainerSchema(
  schema?: SchemaType
): schema is ContainerSchemaType {
  return (
    !!schema &&
    (schema.type === 'loro-map' ||
      schema.type === 'loro-list' ||
      schema.type === 'loro-text' ||
      schema.type === 'loro-movable-list' ||
      schema.type === 'loro-tree')
  );
}

/**
 * Validate a value against a schema
 */
export function validateSchema<S extends SchemaType>(
  schema: S,
  value: unknown
): { valid: boolean; errors?: string[] } {
  const errors: string[] = [];

  // Check if value is required
  if (
    schema.options.required &&
    (value === undefined || (value === null && schema.type !== 'value'))
  ) {
    errors.push('Value is required');
    return { valid: false, errors };
  }

  // Atomic values validate explicit null through their guard; undefined is absence.
  if (value === undefined || (value === null && schema.type !== 'value')) {
    return { valid: true };
  }

  // Validate based on schema type
  switch ((schema as BaseSchemaType).type) {
    case 'string':
      if (typeof value !== 'string') {
        errors.push('Value must be a string');
      }
      break;

    case 'number':
      if (typeof value !== 'number') {
        errors.push('Value must be a number');
      }
      break;

    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push('Value must be a boolean');
      }
      break;

    case 'value':
      if (
        schema.type === 'value' &&
        (!schema.accepts(value) || !isJsonValue(value))
      )
        errors.push('Invalid atomic value');
      break;
    case 'loro-tree':
      if (isLoroTreeSchema(schema)) errors.push(...validateTree(schema, value));
      break;
    case 'ignore':
      // Ignored fields are always valid
      break;

    case 'loro-text':
      if (typeof value !== 'string') {
        errors.push('Content must be a string');
      }
      break;

    case 'loro-map':
      if (!isObject(value)) {
        errors.push('Value must be an object');
      } else if (isLoroMapSchema(schema)) {
        // Validate each property in the map
        for (const key in schema.definition) {
          if (Object.hasOwn(schema.definition, key)) {
            const propSchema = schema.definition[key]!;
            const propValue = (value as Record<string, unknown>)[key];

            const result = validateSchema(propSchema, propValue);
            if (!result.valid && result.errors) {
              // Prepend property name to each error
              const prefixedErrors = result.errors.map(
                (err) => `${key}: ${err}`
              );
              errors.push(...prefixedErrors);
            }
          }
        }
      }
      break;
    case 'loro-movable-list':
    case 'loro-list':
      if (!Array.isArray(value)) {
        errors.push('Value must be an array');
      } else if (isListLikeSchema(schema)) {
        // Validate each item in the list
        value.forEach((item, index) => {
          const result = validateSchema(schema.itemSchema, item);
          if (!result.valid && result.errors) {
            // Prepend array index to each error
            const prefixedErrors = result.errors.map(
              (err) => `Item ${index}: ${err}`
            );
            errors.push(...prefixedErrors);
          }
        });
      }
      break;

    case 'schema':
      if (!isObject(value)) {
        errors.push('Value must be an object');
      } else if (isRootSchemaType(schema)) {
        if (!isObject(value)) {
          errors.push('Value must be an object');
        } else {
          // Validate each property in the schema
          for (const key in schema.definition) {
            if (Object.hasOwn(schema.definition, key)) {
              const propSchema = schema.definition[key]!;
              const propValue = (value as Record<string, unknown>)[key];

              const result = validateSchema(propSchema, propValue);
              if (!result.valid && result.errors) {
                // Prepend property name to each error
                const prefixedErrors = result.errors.map(
                  (err) => `${key}: ${err}`
                );
                errors.push(...prefixedErrors);
              }
            }
          }
          for (const key in value) {
            if (
              !schema.options.allowUnknown &&
              !Object.hasOwn(schema.definition, key)
            ) {
              errors.push(`Unknown property: ${key}`);
            }
          }
        }
      } else {
        errors.push(`Should be a schema, but got ${schema.type}`);
      }
      break;

    default:
      errors.push(`Unknown schema type: ${(schema as BaseSchemaType).type}`);
  }

  // Run custom validation if provided
  if (
    schema.options.validate &&
    typeof schema.options.validate === 'function'
  ) {
    try {
      const customValidation = schema.options.validate(value);
      if (customValidation !== true) {
        const errorMessage =
          typeof customValidation === 'string'
            ? customValidation
            : 'Value failed custom validation';
        errors.push(errorMessage);
      }
    } catch (error) {
      errors.push(`Validation error: ${String(error)}`);
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

/**
 * Get default value for a schema
 * Based on the schema type, it might return a plain value or a wrapped value
 */
export function getDefaultValue<S extends SchemaType>(
  schema: S
): InferType<S> | undefined {
  // If a default value is provided in options, use it
  if ('defaultValue' in schema.options) {
    const defaultValue = schema.options.defaultValue;
    return defaultValue as InferType<S>;
  }

  // Otherwise, create a default based on the schema type
  const schemaType = (schema as BaseSchemaType).type;

  switch (schemaType) {
    case 'string': {
      const value = schema.options.required ? '' : undefined;
      if (value === undefined) return undefined;
      return value as InferType<S>;
    }

    case 'number': {
      const value = schema.options.required ? 0 : undefined;
      if (value === undefined) return undefined;
      return value as InferType<S>;
    }

    case 'boolean': {
      const value = schema.options.required ? false : undefined;
      if (value === undefined) return undefined;
      return value as InferType<S>;
    }

    case 'loro-text': {
      const value = schema.options.required ? '' : undefined;
      if (value === undefined) return undefined;
      return value as InferType<S>;
    }

    case 'loro-map': {
      if (isLoroMapSchema(schema)) {
        const result: Record<string, unknown> = {};
        for (const key in schema.definition) {
          if (Object.hasOwn(schema.definition, key)) {
            const value = getDefaultValue(schema.definition[key]!);
            if (value !== undefined) {
              result[key] = value;
            }
          }
        }
        return result as InferType<S>;
      }
      return {} as InferType<S>;
    }

    case 'loro-tree':
    case 'loro-movable-list':
    case 'loro-list':
      return [] as InferType<S>;

    case 'schema': {
      if (isRootSchemaType(schema)) {
        const result: Record<string, unknown> = {};
        for (const key in schema.definition) {
          if (Object.hasOwn(schema.definition, key)) {
            const value = getDefaultValue(schema.definition[key]!);
            if (value !== undefined) {
              result[key] = value;
            }
          }
        }
        return result as InferType<S>;
      }
      return {} as InferType<S>;
    }

    default:
      return undefined;
  }
}

/**
 * Creates a properly typed value based on the schema
 * This ensures consistency between schema types and runtime values
 */
export function createValueFromSchema<S extends SchemaType>(
  schema: S,
  value: unknown
): InferType<S> {
  // For primitive types, handle wrapping consistently
  const schemaType = (schema as BaseSchemaType).type;

  if (
    schemaType === 'string' ||
    schemaType === 'number' ||
    schemaType === 'boolean'
  ) {
    return value as InferType<S>;
  }

  // For complex types, pass through as is
  return value as InferType<S>;
}

export function validateTree<
  T extends LoroMapSchema<Record<string, SchemaType>>,
>(schema: LoroTreeSchema<T>, value: unknown): string[] {
  const ids = new Set<string>();
  const seen = new Set<object>();
  const errors: string[] = [];
  function visit(nodes: unknown) {
    if (!Array.isArray(nodes)) {
      errors.push('Tree children must be an array');
      return;
    }
    if (seen.has(nodes)) {
      errors.push('Tree contains a cycle or shared children');
      return;
    }
    seen.add(nodes);
    for (const node of nodes) {
      if (
        !node ||
        typeof node !== 'object' ||
        Array.isArray(node) ||
        !('data' in node) ||
        !('children' in node)
      ) {
        errors.push('Tree nodes need data and children');
        continue;
      }
      if (seen.has(node)) {
        errors.push('Tree contains a cycle or duplicate node');
        continue;
      }
      seen.add(node);
      const data = node.data;
      const result = validateSchema(schema.nodeSchema, data);
      if (!data || !result.valid || !isJsonValue(data))
        errors.push(...(result.errors ?? ['Invalid tree node data']));
      else {
        assertSchemaValue(schema.nodeSchema, data);
        const id = schema.idSelector(data);
        if (typeof id !== 'string' || !id || ids.has(id))
          errors.push('Tree IDs must be nonempty and unique');
        ids.add(id);
      }
      visit(node.children);
    }
    // Shared empty arrays are ordinary structural sharing, not a cycle.
    seen.delete(nodes);
  }
  visit(value);
  return errors;
}

export function assertTree<T extends LoroMapSchema<Record<string, SchemaType>>>(
  schema: LoroTreeSchema<T>,
  value: unknown
): asserts value is TreeNode<InferType<T>>[] {
  const errors = validateTree(schema, value);
  if (errors.length) throw new Error(`Invalid tree: ${errors.join(', ')}`);
}
