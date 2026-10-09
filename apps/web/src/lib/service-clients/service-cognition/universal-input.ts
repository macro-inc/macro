import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { z } from 'zod';
import type { ClassifyInputRequest } from './generated/schemas/classifyInputRequest';
import type { ExtractInputRequest } from './generated/schemas/extractInputRequest';
import { InputIntent } from './generated/schemas/inputIntent';

// Wire decoding stays here; the feature adapter maps it into its own vocabulary.
const intent = z.enum(InputIntent);
const text = z.string().nullish();
const classification = z.object({
  revision: z.number(),
  scores: z
    .array(z.object({ intent, score: z.number().min(0).max(1) }))
    .length(7),
});
const extraction = z.object({
  revision: z.number(),
  intent,
  suggestions: z.object({
    title: text,
    body: text,
    subject: text,
    recipients: z.array(z.string()),
    query: text,
    start: text,
    end: text,
    due_date: text,
    location: text,
    guests: z.array(z.string()),
  }),
});

async function request<T>(
  path: string,
  body: object,
  schema: z.ZodType<T>
): Promise<T> {
  const response = await fetchWithToken<Record<string, unknown>>(
    `${SERVER_HOSTS['cognition-service']}/universal-input/${path}`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    }
  );
  if (response.isErr())
    throw new Error(
      'Automatic suggestions are unavailable. Choose a type and fill in the fields.'
    );
  return schema.parse(response.value);
}

export const universalInputClient = {
  classify: (text: string, revision: number) =>
    request(
      'classify',
      { text, revision } satisfies ClassifyInputRequest,
      classification
    ),
  extract: (text: string, selected: z.infer<typeof intent>, revision: number) =>
    request(
      'extract',
      {
        text,
        intent: selected,
        revision,
        reference_time: new Date().toISOString(),
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      } satisfies ExtractInputRequest,
      extraction
    ),
};
