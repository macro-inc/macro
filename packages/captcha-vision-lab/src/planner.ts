/**
 * Planners see a PNG crop of the quiz and its visible prompt, and answer with
 * one of the visible option labels or an abort. Nothing else: no DOM, no
 * accessibility tree, no option ids, no answer.
 */
import { z } from 'zod';
import { KIMI_MODEL } from './registry.ts';

export type PlannerInput = {
  /** PNG screenshot of the quiz region. */
  screenshot: Uint8Array;
  /** The quiz's visible prompt text. */
  prompt: string;
  /** The visible option labels, e.g. A to D. */
  labels: string[];
};

export type PlannerDecision =
  | { kind: 'choice'; label: string }
  | { kind: 'abort'; reason: string };

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type PlannerResult = {
  decision: PlannerDecision;
  usage: TokenUsage | undefined;
  /** The model the provider says answered, when it says. */
  responseModel: string | undefined;
};

export type Planner = {
  provider: 'mock' | 'kimi';
  model: string;
  plan: (input: PlannerInput) => Promise<PlannerResult>;
};

/** A deterministic planner for CI and the mock smoke run. */
export const mockPlanner = (
  choose: (input: PlannerInput) => PlannerDecision
): Planner => ({
  provider: 'mock',
  model: 'mock',
  plan: async (input) => ({
    decision: choose(input),
    usage: undefined,
    responseModel: undefined,
  }),
});

const SYSTEM_PROMPT =
  'You answer a visual shapes quiz from a lab test fixture. The image shows ' +
  'a prompt and four options, each labelled with a letter. Reply with JSON ' +
  'only: {"choice": "<label>"} for the option that matches the prompt, or ' +
  '{"abort": "<short reason>"} if you cannot tell.';

/** The strict schema the model must answer with. */
export const answerSchema = (labels: string[]) => ({
  name: 'lab_quiz_answer',
  strict: true,
  schema: {
    anyOf: [
      {
        type: 'object',
        properties: { choice: { type: 'string', enum: labels } },
        required: ['choice'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: { abort: { type: 'string', maxLength: 200 } },
        required: ['abort'],
        additionalProperties: false,
      },
    ],
  },
});

const Answer = z.union([
  z.strictObject({ choice: z.string() }),
  z.strictObject({ abort: z.string().max(200) }),
]);

const Completion = z.object({
  model: z.string().optional(),
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
    })
    .optional(),
});

export type KimiPlannerOptions = {
  /** An OpenAI-compatible base URL, e.g. Fireworks or a loopback stand-in. */
  baseUrl: string;
  apiKey: string;
  model?: string;
  timeoutMs?: number;
};

/**
 * Kimi vision over an OpenAI-compatible chat completions API. Any transport,
 * status, parse or schema problem throws: the runner records it as a model
 * error and takes no action.
 */
export const kimiPlanner = ({
  baseUrl,
  apiKey,
  model = KIMI_MODEL,
  timeoutMs = 60_000,
}: KimiPlannerOptions): Planner => ({
  provider: 'kimi',
  model,
  plan: async ({ screenshot, prompt, labels }) => {
    const image = Buffer.from(screenshot).toString('base64');
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        // Kimi K3 reasons by default and would spend the token cap on it.
        reasoning_effort: 'none',
        max_tokens: 64,
        response_format: {
          type: 'json_schema',
          json_schema: answerSchema(labels),
        },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${image}` },
              },
            ],
          },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`provider answered ${response.status}`);
    }

    const completion = Completion.parse(await response.json());
    const answer = Answer.parse(
      JSON.parse(completion.choices[0]!.message.content)
    );
    const decision: PlannerDecision =
      'choice' in answer
        ? { kind: 'choice', label: answer.choice }
        : { kind: 'abort', reason: answer.abort };
    if (decision.kind === 'choice' && !labels.includes(decision.label)) {
      throw new Error('provider chose a label that is not on the page');
    }

    return {
      decision,
      responseModel: completion.model,
      usage:
        completion.usage === undefined
          ? undefined
          : {
              promptTokens: completion.usage.prompt_tokens,
              completionTokens: completion.usage.completion_tokens,
              totalTokens: completion.usage.total_tokens,
            },
    };
  },
});
