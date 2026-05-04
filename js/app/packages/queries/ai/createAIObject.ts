import { isErr } from '@core/util/maybeResult';
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
  /** Zod v4 schema used for OpenAI structured outputs and final validation. */
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

function toJsonSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, {
    target: 'draft-07',
    unrepresentable: 'throw',
    cycles: 'throw',
    reused: 'inline',
  });
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

  if (isErr(response)) {
    throw new Error(response[0].map((error) => error.message).join(', '));
  }

  const content = response[1].choices[0]?.message?.content;
  if (!content) {
    throw new Error('AI object completion returned no content');
  }

  const parsedJson = JSON.parse(content);
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
