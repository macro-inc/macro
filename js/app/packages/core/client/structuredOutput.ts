import { isErr } from '@core/util/maybeResult';
import { dcsCompletion } from '@service-cognition/client';
import { z } from 'zod';

type StructuredOutputSchema = {
  type: string;
  properties: Record<string, any>;
  required: string[];
  additionalProperties: boolean;
};

function toJsonSchema(schema: z.ZodType | StructuredOutputSchema) {
  if (!('safeParse' in schema)) {
    return schema;
  }

  return z.toJSONSchema(schema, {
    target: 'draft-07',
    unrepresentable: 'throw',
    cycles: 'throw',
    reused: 'inline',
  });
}

/**
 * Sends a structured output completion to the dcs
 *
 * @type T - The type of the completion
 * @param prompt - The prompt to send to the dcs
 * @param schema - A Zod v4 schema or valid OpenAI structured output schema
 * @param schema_name - The name of the schema (should be formatted using snake case)
 *
 * @returns The completion response
 *
 * @example
 * ```tsx
 * const completion = await structuredOutputCompletion<string>(
 *   'Hello world',
 *   {
 *     type: 'object',
 *     properties: {
 *       greeting: { type: 'string' },
 *       name: { type: 'string' },
 *     },
 *     required: ['greeting', 'name'],
 *   },
 *   'greeting_and_name'
 * );
 *
 * return <div>{completion}</div>
 * ```
 */
export async function structuredOutputCompletion<T>(
  prompt: string,
  schema: z.ZodType<T> | StructuredOutputSchema,
  schema_name: string
): Promise<T | undefined> {
  const response = await dcsCompletion({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: schema_name,
        strict: true,
        schema: toJsonSchema(schema),
      },
    },
  });

  if (isErr(response)) {
    console.error('Error in structured output completion');
    return;
  }

  const content = response[1].choices[0]?.message?.content;
  if (!content) {
    console.error('No completion in structured output completion');
    return undefined;
  }

  const json = JSON.parse(content);
  return 'safeParse' in schema ? schema.parse(json) : (json as T);
}
