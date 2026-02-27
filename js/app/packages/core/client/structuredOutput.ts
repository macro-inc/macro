import { isErr } from '@core/util/maybeResult';
import { dcsCompletion } from '@service-cognition/client';

type StructuredOutputSchema = {
  type: string;
  properties: Record<string, any>;
  required: string[];
  additionalProperties: boolean;
};

/**
 * Sends a structured output completion to the dcs
 *
 * @type T - The type of the completion
 * @param prompt - The prompt to send to the dcs
 * @param schema - A valid openai structured output schema
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
  schema: StructuredOutputSchema,
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
        schema,
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

  return JSON.parse(content) as T;
}
