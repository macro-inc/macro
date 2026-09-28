import type { StandardSchemaV1 } from '@standard-schema/spec';
import deepEqual from 'fast-deep-equal';
import type { SerializedSearchParams } from './types';
import { takeLast } from './utils';

export type SearchParamsRecord = Record<string, unknown>;
export type SearchParamsSchema<T> = StandardSchemaV1<unknown, T>;
export type SearchParamsSerializer<T> = (
  value: T,
  context: { defaults: T }
) => SerializedSearchParams | undefined;
export type SearchParamsDeserializer<T> = (
  params: SerializedSearchParams
) => Partial<T>;

export type SearchParamsCodecOptions<T extends SearchParamsRecord> = {
  schema: SearchParamsSchema<T>;
  defaults: T;
} & (
  | { serialize?: never; deserialize?: never }
  | {
      serialize: SearchParamsSerializer<T>;
      deserialize: SearchParamsDeserializer<T>;
    }
);

type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: unknown };

export type SearchParamsCodec<T> = {
  parse(params: SerializedSearchParams | undefined): {
    value: T;
    valid: boolean;
  };
  serialize(value: T): SerializedSearchParams | undefined;
  validate(value: unknown): ValidationResult<T>;
};

function defaultDeserialize<T extends SearchParamsRecord>(
  params: SerializedSearchParams | undefined,
  defaults: T
): Partial<T> {
  if (!params) return {};
  const result: SearchParamsRecord = {};
  for (const key of Object.keys(defaults)) {
    const values = params[key];
    if (!values || values.length === 0) continue;
    const fallback = defaults[key];
    if (Array.isArray(fallback)) {
      result[key] = values.length === 1 && values[0] === '' ? [] : [...values];
    } else if (typeof fallback === 'number') {
      result[key] = Number(takeLast(values));
    } else if (typeof fallback === 'boolean') {
      result[key] = takeLast(values) === 'true';
    } else {
      result[key] = takeLast(values);
    }
  }
  return result as Partial<T>;
}

function defaultSerialize<T extends SearchParamsRecord>(
  value: T,
  defaults: T
): SerializedSearchParams | undefined {
  const result: SerializedSearchParams = {};
  for (const [key, field] of Object.entries(value)) {
    if (field === undefined || deepEqual(field, defaults[key])) continue;
    if (Array.isArray(field)) {
      result[key] =
        field.length === 0 ? [''] : field.map((item) => String(item));
    } else {
      result[key] = [String(field)];
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function createSearchParamsCodec<T extends SearchParamsRecord>(
  options: SearchParamsCodecOptions<T>
): SearchParamsCodec<T> {
  const validate = (value: unknown): ValidationResult<T> => {
    const result = options.schema['~standard'].validate(value);
    if (result instanceof Promise) {
      throw new Error('Search parameter schemas must be synchronous');
    }
    return result.issues
      ? { success: false, error: result.issues }
      : { success: true, data: result.value };
  };

  if (!validate(options.defaults).success) {
    throw new Error('Invalid defaults for search params');
  }

  return {
    validate,
    parse(params) {
      try {
        const decoded = options.deserialize
          ? options.deserialize(params ?? {})
          : defaultDeserialize(params, options.defaults);
        const parsed = validate({ ...options.defaults, ...decoded });
        if (parsed.success) return { value: parsed.data, valid: true };
      } catch {
        // Invalid inbound URL state falls back to defaults and is canonicalized.
      }
      return { value: options.defaults, valid: false };
    },
    serialize(value) {
      if (deepEqual(value, options.defaults)) return;
      if (!options.serialize) return defaultSerialize(value, options.defaults);
      const params = options.serialize(value, { defaults: options.defaults });
      // Keep the codec's result separate from mutable/custom serializer state.
      const entries = Object.entries(params ?? {}).map(([key, values]) => [
        key,
        [...values],
      ]);
      return entries.length > 0 ? Object.fromEntries(entries) : undefined;
    },
  };
}
