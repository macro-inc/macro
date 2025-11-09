import { isErr } from '@core/util/maybeResult';
import { cognitionApiServiceClient } from '@service-cognition/client';

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
  let response = await cognitionApiServiceClient.structuredOuputCompletion({
    prompt: prompt,
    schema,
    schema_name: schema_name,
  });

  if (isErr(response)) {
    console.error('Error in structured output completion');
    return;
  }

  const completion = response.at(1)?.completion;
  if (!completion) {
    console.error('No completion in structured output completion');
    return undefined;
  }

  return completion as T;
}
