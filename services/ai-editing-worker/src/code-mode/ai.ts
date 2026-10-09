import {
  generateText,
  type LanguageModel,
  type LanguageModelUsage,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
} from 'ai';
import { z } from 'zod';

export const generationRequestSchema = z
  .strictObject({
    model: z.enum(['fast', 'good']).default('fast'),
    prompt: z.string().min(1).max(65_536),
    system: z.string().max(65_536).optional(),
    maxOutputTokens: z.number().int().min(1).max(4096).default(1024),
    schema: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (v) =>
      new TextEncoder().encode(v.prompt + (v.system ?? '')).length <= 65_536,
    'Prompt and system together exceed 64 KiB.'
  );

/** Deliberately limited JSON Schema vocabulary; no refs, regexes or eval. */
export function objectSchema(input: Record<string, unknown>) {
  const invalid = (message: string): never => {
    throw new z.ZodError([{ code: 'custom', path: ['schema'], message }]);
  };
  if (input.type !== 'object')
    invalid('Structured output requires an object root schema.');
  if (new TextEncoder().encode(JSON.stringify(input)).length > 16_384)
    invalid('Schema exceeds 16 KiB.');
  let nodes = 0;
  const visit = (value: unknown, depth: number): void => {
    if (depth > 8 || ++nodes > 200)
      invalid('Schema exceeds complexity limits.');
    const parsed = z
      .strictObject({
        type: z.enum([
          'object',
          'array',
          'string',
          'number',
          'integer',
          'boolean',
          'null',
        ]),
        description: z.string().optional(),
        properties: z.record(z.string(), z.unknown()).optional(),
        required: z.array(z.string()).optional(),
        additionalProperties: z.boolean().optional(),
        items: z.record(z.string(), z.unknown()).optional(),
        enum: z
          .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .min(1)
          .max(100)
          .optional(),
        minLength: z.number().int().min(0).max(65_536).optional(),
        maxLength: z.number().int().min(0).max(65_536).optional(),
        minimum: z.number().optional(),
        maximum: z.number().optional(),
        minItems: z.number().int().min(0).max(1000).optional(),
        maxItems: z.number().int().min(0).max(1000).optional(),
      })
      .parse(value);
    if (parsed.enum) {
      // Zod resolves enum before type and other constraints. Accept only typed,
      // unconstrained primitive enums so conversion cannot weaken the schema.
      if (
        Object.keys(parsed).some(
          (key) => !['type', 'description', 'enum'].includes(key)
        )
      )
        invalid(
          'Enums accept only type and description; omit sibling constraints.'
        );
      for (const value of parsed.enum) {
        const matches =
          parsed.type === 'null'
            ? value === null
            : parsed.type === 'integer'
              ? typeof value === 'number' && Number.isInteger(value)
              : ['string', 'number', 'boolean'].includes(parsed.type) &&
                typeof value === parsed.type;
        if (!matches)
          invalid('Enum values must match a primitive schema type.');
      }
    }
    for (const child of Object.values(parsed.properties ?? {}))
      visit(child, depth + 1);
    if (parsed.items) visit(parsed.items, depth + 1);
  };
  visit(input, 1);
  return z
    .fromJSONSchema(input)
    .refine(
      (value) =>
        value !== null && typeof value === 'object' && !Array.isArray(value),
      'Structured output must be an object.'
    );
}

/** One bounded Vercel AI SDK call, without agent tools or provider retries. */
export async function runGeneration(
  input: z.infer<typeof generationRequestSchema>,
  model: Exclude<LanguageModel, string>,
  signal: AbortSignal
) {
  const request = generationRequestSchema.parse(input);
  const output = request.schema
    ? Output.object({ schema: objectSchema(request.schema) })
    : undefined;
  try {
    const result = await generateText({
      model,
      prompt: request.prompt,
      system: request.system,
      maxOutputTokens: request.maxOutputTokens,
      maxRetries: 0,
      abortSignal: signal,
      output,
    });
    const completed = {
      text: result.text,
      model: result.response.modelId,
      finishReason: result.finishReason,
      usage: usageEvidence(result.totalUsage),
    };
    if (!request.schema) return completed;
    try {
      return { ...completed, object: result.output };
    } catch (error) {
      // The SDK's output getter can fail after a billed, reasoning-only reply.
      if (!NoOutputGeneratedError.isInstance(error)) throw error;
      return {
        ...completed,
        error: 'No structured output generated. Increase maxOutputTokens.',
      };
    }
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error) || !error.usage) throw error;
    return {
      text: '',
      model: error.response?.modelId ?? model.modelId,
      finishReason: error.finishReason ?? 'error',
      usage: usageEvidence(error.usage),
      error: 'AI output did not match the requested schema.',
    };
  }
}

function usageEvidence(usage: LanguageModelUsage) {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? 0,
  };
}
