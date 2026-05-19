import { dcsCompletion } from '@service-cognition/client';
import {
  type SolidMutationOptions,
  type UseMutationResult,
  useMutation,
} from '@tanstack/solid-query';
import type OpenAI from 'openai';
import { z } from 'zod';

type ChatMessage = OpenAI.ChatCompletionMessageParam;
type ChatModel = OpenAI.ChatModel | (string & {});
type JsonObject = Record<string, unknown>;

export type AIObjectSchemaViolation = {
  path: string;
  message: string;
};

export class AIObjectSchemaError extends Error {
  constructor(public readonly violations: readonly AIObjectSchemaViolation[]) {
    super(
      [
        'Zod schema is not compatible with OpenAI strict structured outputs.',
        ...violations.map((violation) => `- ${violation.message}`),
      ].join('\n')
    );
    this.name = 'AIObjectSchemaError';
  }
}

export class AIObjectParseError extends Error {
  constructor(
    public readonly content: string,
    public readonly parseError: unknown
  ) {
    super('AI object completion returned invalid JSON');
    this.name = 'AIObjectParseError';
  }
}

export class AIObjectValidationError<T> extends Error {
  constructor(public readonly zodError: z.ZodError<T>) {
    super(zodError.message);
    this.name = 'AIObjectValidationError';
  }
}

export type CreateAIObjectOptions<
  Schema extends z.ZodType,
  Variables = string,
  OnMutateResult = unknown,
> = Omit<
  SolidMutationOptions<z.infer<Schema>, Error, Variables, OnMutateResult>,
  'mutationFn'
> & {
  /**
   * Zod v4 schema used for OpenAI structured outputs and final validation.
   *
   * OpenAI `strict: true` requires every object property to be required. Use
   * `.nullable()` for values the model may omit semantically; `.optional()` is
   * rejected before sending the request.
   */
  schema: Schema;
  /** Name sent to OpenAI for the json_schema response format. */
  schemaName?: string;
  /** Model for the DCS `/chat/completions` proxy. */
  model?: ChatModel;
  /** Optional system message prepended to generated messages. */
  system?: string;
  /** Static prompt or prompt factory. Defaults to the submitted variables. */
  prompt?: string | ((variables: Variables) => string);
  /** Static messages or message factory. Overrides `system` and `prompt`. */
  messages?: ChatMessage[] | ((variables: Variables) => ChatMessage[]);
  temperature?: number;
  maxTokens?: number;
};

export type CreateAIObjectResult<
  Schema extends z.ZodType,
  Variables = string,
  OnMutateResult = unknown,
> = UseMutationResult<z.infer<Schema>, Error, Variables, OnMutateResult>;

function defaultSchemaName(schema: z.ZodType): string {
  return (
    schema.description
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'ai_object'
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatJsonPath(path: readonly string[]): string {
  if (path.length === 0) {
    return '$';
  }

  return `$${path.map((part) => `.${part}`).join('')}`;
}

function collectStrictSchemaViolations(
  schema: unknown,
  path: readonly string[] = []
): AIObjectSchemaViolation[] {
  if (!isJsonObject(schema)) {
    return [];
  }

  const violations: AIObjectSchemaViolation[] = [];
  const properties = schema.properties;
  const type = schema.type;
  const isObjectSchema =
    type === 'object' || (Array.isArray(type) && type.includes('object'));

  if (isObjectSchema) {
    if (schema.additionalProperties !== false) {
      violations.push({
        path: formatJsonPath(path),
        message: `${formatJsonPath(path)} must set additionalProperties: false.`,
      });
    }

    if (isJsonObject(properties)) {
      const required = schema.required;
      const requiredProperties = new Set(
        Array.isArray(required)
          ? required.filter(
              (property): property is string => typeof property === 'string'
            )
          : []
      );

      for (const property of Object.keys(properties)) {
        if (!requiredProperties.has(property)) {
          violations.push({
            path: formatJsonPath([...path, property]),
            message: `${formatJsonPath([
              ...path,
              property,
            ])} is optional. OpenAI strict structured outputs require every object property to be required; use .nullable() instead of .optional().`,
          });
        }
      }
    }
  }

  if (isJsonObject(properties)) {
    for (const [property, propertySchema] of Object.entries(properties)) {
      violations.push(
        ...collectStrictSchemaViolations(propertySchema, [...path, property])
      );
    }
  }

  const items = schema.items;
  if (isJsonObject(items)) {
    violations.push(...collectStrictSchemaViolations(items, [...path, '[]']));
  } else if (Array.isArray(items)) {
    for (const [index, item] of items.entries()) {
      violations.push(
        ...collectStrictSchemaViolations(item, [...path, `[${index}]`])
      );
    }
  }

  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const schemas = schema[key];
    if (!Array.isArray(schemas)) {
      continue;
    }

    for (const childSchema of schemas) {
      violations.push(...collectStrictSchemaViolations(childSchema, path));
    }
  }

  for (const key of ['$defs', 'definitions'] as const) {
    const definitions = schema[key];
    if (!isJsonObject(definitions)) {
      continue;
    }

    for (const [name, definition] of Object.entries(definitions)) {
      violations.push(
        ...collectStrictSchemaViolations(definition, [...path, key, name])
      );
    }
  }

  return violations;
}

function toJsonSchema(schema: z.ZodType) {
  const jsonSchema = z.toJSONSchema(schema, {
    target: 'draft-07',
    unrepresentable: 'throw',
    cycles: 'throw',
    reused: 'inline',
  });

  const violations = collectStrictSchemaViolations(jsonSchema);
  if (violations.length > 0) {
    throw new AIObjectSchemaError(violations);
  }

  return jsonSchema;
}

function stringifyVariables(variables: unknown): string {
  return typeof variables === 'string' ? variables : JSON.stringify(variables);
}

function buildMessages<Variables>(
  options: CreateAIObjectOptions<z.ZodType, Variables>,
  variables: Variables
): ChatMessage[] {
  if (typeof options.messages === 'function') {
    return options.messages(variables);
  }

  if (options.messages) {
    return options.messages;
  }

  const prompt =
    typeof options.prompt === 'function'
      ? options.prompt(variables)
      : (options.prompt ?? stringifyVariables(variables));

  const messages: ChatMessage[] = [];
  if (options.system) {
    messages.push({ role: 'system', content: options.system });
  }
  messages.push({ role: 'user', content: prompt });
  return messages;
}

async function generateAIObject<Schema extends z.ZodType, Variables>(
  options: CreateAIObjectOptions<Schema, Variables>,
  variables: Variables
): Promise<z.infer<Schema>> {
  const response = await dcsCompletion({
    model: options.model ?? 'gpt-4o-mini',
    messages: buildMessages(options, variables),
    ...(options.temperature === undefined
      ? {}
      : { temperature: options.temperature }),
    ...(options.maxTokens === undefined
      ? {}
      : { max_tokens: options.maxTokens }),
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: options.schemaName ?? defaultSchemaName(options.schema),
        strict: true,
        schema: toJsonSchema(options.schema),
      },
    },
  });

  if (response.isErr()) {
    throw new Error(response.error.map((error) => error.message).join(', '));
  }

  const content = response.value.choices[0]?.message?.content;
  if (!content) {
    throw new Error('AI object completion returned no content');
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch (error) {
    throw new AIObjectParseError(content, error);
  }

  const parsedObject = options.schema.safeParse(parsedJson);
  if (!parsedObject.success) {
    throw new AIObjectValidationError(parsedObject.error);
  }

  return parsedObject.data;
}

/**
 * TanStack mutation for DCS structured object generation.
 *
 * This behaves like `useMutation`: pass standard mutation options (`onSuccess`,
 * `onError`, `onSettled`, `retry`, etc.) and call `mutate` or `mutateAsync`.
 *
 * @example
 * ```tsx
 * const mutation = createAIObject({
 *   schema: z.object({ title: z.string() }),
 *   prompt: (text: string) => `Generate a title for: ${text}`,
 *   onSuccess: (object) => console.log(object.title),
 * });
 *
 * mutation.mutate('Quarterly planning notes');
 * mutation.data?.title;
 * ```
 */
export function createAIObject<
  Schema extends z.ZodType,
  Variables = string,
  OnMutateResult = unknown,
>(
  options: CreateAIObjectOptions<Schema, Variables, OnMutateResult>
): CreateAIObjectResult<Schema, Variables, OnMutateResult> {
  return useMutation<z.infer<Schema>, Error, Variables, OnMutateResult>(() => ({
    ...options,
    mutationFn: async (variables) => await generateAIObject(options, variables),
  }));
}
