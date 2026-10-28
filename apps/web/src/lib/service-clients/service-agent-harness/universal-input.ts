import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { statusError } from '@core/util/safeFetch';
import type { Span } from '@macro-inc/observability';
import { z } from 'zod';
import type { ClassifyInputRequest } from './generated/schemas/classifyInputRequest';
import type { ExtractInputRequest } from './generated/schemas/extractInputRequest';
import { InputIntent } from './generated/schemas/inputIntent';
import type { SearchSuggestions } from './generated/schemas/searchSuggestions';
import {
  type InferenceResponseCode,
  UniversalInputRequestError,
} from './universal-input-error';

const intent = z.enum(InputIntent);
const text = z.string().nullish();
const classification = z.object({
  revision: z.number(),
  scores: z
    .array(z.object({ intent, score: z.number().min(0).max(1) }))
    .length(7),
});
const weekday = z.enum(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']);
const recurrence = z.object({
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
  interval: z.number().int().positive(),
  by_day: z.array(weekday),
  monthly_by_day: z.object({ ordinal: z.number().int(), weekday }).nullish(),
  ends: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('never') }),
    z.object({ kind: z.literal('after'), count: z.number().int().positive() }),
    z.object({ kind: z.literal('on'), date: z.iso.date() }),
  ]),
});
// Require every generated wire field, including optional additions, in its decoder.
type SearchDecoderFields<Type extends SearchSuggestions['type']> = {
  [Field in keyof Extract<SearchSuggestions, { type: Type }>]-?: z.ZodType<
    Extract<SearchSuggestions, { type: Type }>[Field]
  >;
};
const SEARCH_SCHEMAS = {
  all: z.strictObject({
    type: z.literal('all'),
    query: text,
  } satisfies SearchDecoderFields<'all'>),
  'document-or-file': z.strictObject({
    type: z.literal('document-or-file'),
    query: text,
  } satisfies SearchDecoderFields<'document-or-file'>),
  folders: z.strictObject({
    type: z.literal('folders'),
    query: text,
  } satisfies SearchDecoderFields<'folders'>),
  agent: z.strictObject({
    type: z.literal('agent'),
    query: text,
  } satisfies SearchDecoderFields<'agent'>),
  calendar: z.strictObject({
    type: z.literal('calendar'),
    query: text,
  } satisfies SearchDecoderFields<'calendar'>),
  channels: z.strictObject({
    type: z.literal('channels'),
    query: text,
    from: z.array(z.string()),
    in: z.array(z.string()),
  } satisfies SearchDecoderFields<'channels'>),
  task: z.strictObject({
    type: z.literal('task'),
    query: text,
    status: z.array(z.string()),
    priority: z.array(z.string()),
    assignees: z.array(z.string()),
    created_by: z.array(z.string()),
  } satisfies SearchDecoderFields<'task'>),
  calls: z.strictObject({
    type: z.literal('calls'),
    query: text,
    from: z.array(z.string()),
    in: z.array(z.string()),
    status: text,
  } satisfies SearchDecoderFields<'calls'>),
  email: z.strictObject({
    type: z.literal('email'),
    query: text,
    importance: text,
    inboxes: z.array(z.string()),
  } satisfies SearchDecoderFields<'email'>),
} satisfies Record<SearchSuggestions['type'], z.ZodType>;
const { all: ALL_SEARCH_SCHEMA, ...TYPE_SEARCH_SCHEMAS } = SEARCH_SCHEMAS;

const extraction = z.discriminatedUnion('intent', [
  z.object({
    revision: z.number(),
    intent: z.literal('ai'),
    suggestions: z.object({}),
  }),
  z.object({
    revision: z.number(),
    intent: z.literal('search'),
    suggestions: z.discriminatedUnion('type', [
      ALL_SEARCH_SCHEMA,
      ...Object.values(TYPE_SEARCH_SCHEMAS),
    ]),
  }),
  z.object({
    revision: z.number(),
    intent: z.literal('email'),
    suggestions: z.object({
      subject: text,
      body: text,
      recipients: z.array(z.string()).default([]),
      cc: z.array(z.string()).default([]),
      bcc: z.array(z.string()).default([]),
    }),
  }),
  z.object({
    revision: z.number(),
    intent: z.literal('note'),
    suggestions: z.object({ title: text, body: text }),
  }),
  z.object({
    revision: z.number(),
    intent: z.literal('task'),
    suggestions: z.object({
      title: text,
      body: text,
      due_date: text,
      properties: z
        .array(z.object({ name: z.string(), values: z.array(z.string()) }))
        .default([]),
    }),
  }),
  z.object({
    revision: z.number(),
    intent: z.literal('calendar'),
    suggestions: z.object({
      title: text,
      body: text,
      start: text,
      start_assumption: text,
      end: text,
      location: text,
      guests: z.array(z.string()).default([]),
      recurrence: recurrence.nullish(),
    }),
  }),
  z.object({
    revision: z.number(),
    intent: z.literal('message'),
    suggestions: z.object({
      body: text,
      recipients: z.array(z.string()).default([]),
    }),
  }),
]);

async function request<T>(
  path: string,
  body: object,
  schema: z.ZodType<T>,
  parentSpan?: Span
): Promise<T> {
  const signal = AbortSignal.timeout(15000);
  const response = await fetchWithToken<
    Record<string, unknown>,
    InferenceResponseCode
  >(`${SERVER_HOSTS['agent-harness']}/universal_input/${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
    trace: parentSpan ? { parentSpan } : undefined,
    errorResponseHandler: async (response) => {
      const code =
        response.status === 400
          ? 'INVALID_REQUEST'
          : response.status === 402
            ? 'ALLOWANCE_EXHAUSTED'
            : response.status === 429
              ? 'RATE_LIMITED'
              : response.status >= 500
                ? 'UNAVAILABLE'
                : undefined;
      if (code) return { code, message: code };
      return statusError(response.status);
    },
  });
  if (response.isErr())
    throw new UniversalInputRequestError(
      signal.aborted ? 'TIMEOUT' : (response.error[0]?.code ?? 'UNKNOWN_ERROR')
    );
  const decoded = schema.safeParse(response.value);
  if (!decoded.success)
    throw new UniversalInputRequestError('INVALID_RESPONSE');
  return decoded.data;
}

export const universalInputClient = {
  classify: (text: string, revision: number, parentSpan?: Span) =>
    request(
      'classify',
      { text, revision } satisfies ClassifyInputRequest,
      classification,
      parentSpan
    ),
  extract: (
    text: string,
    selected: z.infer<typeof intent>,
    revision: number,
    properties: { name: string; options: string[] }[] = [],
    searchType?: ExtractInputRequest['search_type'],
    parentSpan?: Span
  ) =>
    request(
      'extract',
      {
        text,
        intent: selected,
        search_type: selected === 'search' ? searchType : undefined,
        revision,
        reference_time: new Date().toISOString(),
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        property_definitions:
          selected === 'task' || selected === 'search' ? properties : [],
      } satisfies ExtractInputRequest,
      extraction,
      parentSpan
    ),
};
