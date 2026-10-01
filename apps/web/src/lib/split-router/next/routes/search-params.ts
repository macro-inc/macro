import type { StandardSchemaV1 } from '@standard-schema/spec';
import deepEqual from 'fast-deep-equal';
import type { SerializedSearchParams } from './types';

export type SearchParamsRecord = Record<string, unknown>;
type SearchParamsSchema<T> = StandardSchemaV1<unknown, T>;
type SearchParamsSerializer<T> = (
  value: T,
  context: { defaults: T }
) => SerializedSearchParams | undefined;
type SearchParamsDeserializer<T> = (
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

function deserializeField(
  values: readonly string[],
  fallback: unknown
): unknown {
  const last = values.at(-1);

  if (Array.isArray(fallback)) {
    const encodesEmpty = values.length === 1 && values[0] === '';

    return encodesEmpty ? [] : [...values];
  }

  if (typeof fallback === 'number') return Number(last);
  if (typeof fallback === 'boolean') return last === 'true';

  return last;
}

function defaultDeserialize<T extends SearchParamsRecord>(
  params: SerializedSearchParams | undefined,
  defaults: T
): Partial<T> {
  if (!params) return {};

  const result: SearchParamsRecord = {};

  for (const key of Object.keys(defaults)) {
    const values = params[key];
    if (!values?.length) continue;

    result[key] = deserializeField(values, defaults[key]);
  }

  return result as Partial<T>;
}

function serializeField(field: unknown): string[] {
  if (!Array.isArray(field)) return [String(field)];
  if (field.length === 0) return [''];

  return field.map((item) => String(item));
}

function defaultSerialize<T extends SearchParamsRecord>(
  value: T,
  defaults: T
): SerializedSearchParams | undefined {
  const result: SerializedSearchParams = {};

  for (const [key, field] of Object.entries(value)) {
    const omitted = field === undefined || deepEqual(field, defaults[key]);
    if (omitted) continue;

    result[key] = serializeField(field);
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function validateSchema<T>(
  schema: SearchParamsSchema<T>,
  value: unknown
): ValidationResult<T> {
  const result = schema['~standard'].validate(value);

  if (result instanceof Promise) {
    throw new Error('Search parameter schemas must be synchronous');
  }

  if (result.issues) return { success: false, error: result.issues };

  return { success: true, data: result.value };
}

function deserializeParams<T extends SearchParamsRecord>(
  options: SearchParamsCodecOptions<T>,
  params: SerializedSearchParams | undefined
): Partial<T> {
  if (options.deserialize) return options.deserialize(params ?? {});

  return defaultDeserialize(params, options.defaults);
}

function copyParams(
  params: SerializedSearchParams | undefined
): SerializedSearchParams | undefined {
  const entries = Object.entries(params ?? {}).map(
    ([key, values]): [string, string[]] => [key, [...values]]
  );
  if (entries.length === 0) return;

  return Object.fromEntries(entries);
}

export function createSearchParamsCodec<T extends SearchParamsRecord>(
  options: SearchParamsCodecOptions<T>
): SearchParamsCodec<T> {
  function validate(value: unknown): ValidationResult<T> {
    return validateSchema(options.schema, value);
  }

  if (!validate(options.defaults).success) {
    throw new Error('Invalid defaults for search params');
  }

  return {
    validate,

    parse(params) {
      try {
        const decoded = deserializeParams(options, params);
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

      // Keep the codec's result separate from mutable serializer state.
      return copyParams(params);
    },
  };
}
