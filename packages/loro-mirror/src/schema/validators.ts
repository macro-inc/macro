import { isObject } from '../core/utils';
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
  RootSchemaType,
  SchemaType,
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
      schema.type === 'loro-movable-list')
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
  if (schema.options.required && (value === undefined || value === null)) {
    errors.push('Value is required');
    return { valid: false, errors };
  }

  // If value is undefined or null and not required, it's valid
  if (value === undefined || value === null) {
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
          if (Object.prototype.hasOwnProperty.call(schema.definition, key)) {
            const propSchema = schema.definition[key];
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
      } else if (isLoroListSchema(schema)) {
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
            if (Object.prototype.hasOwnProperty.call(schema.definition, key)) {
              const propSchema = schema.definition[key];
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
            if (!Object.prototype.hasOwnProperty.call(schema.definition, key)) {
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
          if (Object.prototype.hasOwnProperty.call(schema.definition, key)) {
            const value = getDefaultValue(schema.definition[key]);
            if (value !== undefined) {
              result[key] = value;
            }
          }
        }
        return result as InferType<S>;
      }
      return {} as InferType<S>;
    }

    case 'loro-list':
      return [] as InferType<S>;

    case 'schema': {
      if (isRootSchemaType(schema)) {
        const result: Record<string, unknown> = {};
        for (const key in schema.definition) {
          if (Object.prototype.hasOwnProperty.call(schema.definition, key)) {
            const value = getDefaultValue(schema.definition[key]);
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
