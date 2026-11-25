/**
 * Planners see a PNG crop of the quiz and its visible prompt, and answer with
 * the family's own bounded response: one visible label, every visible label
 * once in order, or a short string of digits; or an abort. Nothing else: no
 * DOM, no accessibility tree, no option ids, no answer, no coordinates.
 */
import { z } from 'zod';
import { TEXT_LENGTH, TEXT_PATTERN } from './families.ts';
import { KIMI_MODEL } from './registry.ts';

/** What the planner may answer, from the family and the visible page. */
export type ResponseSpec =
  | { kind: 'choice'; labels: string[] }
  | { kind: 'order'; labels: string[] }
  | { kind: 'text' };

export type PlannerInput = {
  /** PNG screenshot of the quiz region. */
  screenshot: Uint8Array;
  /** The quiz's visible prompt text. */
  prompt: string;
  response: ResponseSpec;
};

export type PlannerDecision =
  | { kind: 'choice'; label: string }
  | { kind: 'order'; labels: string[] }
  | { kind: 'text'; text: string }
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

/**
 * A planner failure, described by a fixed code so no model output is kept,
 * with the call's token usage when the provider reported it.
 */
export class PlannerError extends Error {
  constructor(
    readonly code: string,
    readonly usage: TokenUsage | undefined = undefined
  ) {
    super(code);
    this.name = 'PlannerError';
  }
}

export type Planner = {
  provider: 'mock' | 'kimi';
  model: string;
  plan: (input: PlannerInput) => Promise<PlannerResult>;
};

/** Whether a decision is one the spec allows. */
export const fitsSpec = (
  decision: PlannerDecision,
  spec: ResponseSpec
): boolean => {
  if (decision.kind === 'abort') return true;
  if (decision.kind === 'choice' && spec.kind === 'choice') {
    return spec.labels.includes(decision.label);
  }
  if (decision.kind === 'order' && spec.kind === 'order') {
    const { labels } = decision;
    return (
      labels.length === spec.labels.length &&
      new Set(labels).size === labels.length &&
      labels.every((label) => spec.labels.includes(label))
    );
  }
  if (decision.kind === 'text' && spec.kind === 'text') {
    return TEXT_PATTERN.test(decision.text);
  }
  return false;
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

const strictObject = (property: string, schema: object) => ({
  type: 'object',
  properties: { [property]: schema },
  required: [property],
  additionalProperties: false,
});

/** The response itself, per kind, as JSON Schema. */
const responseSchema = (spec: ResponseSpec) => {
  if (spec.kind === 'text') {
    return strictObject('text', {
      type: 'string',
      pattern: TEXT_PATTERN.source,
      minLength: TEXT_LENGTH,
      maxLength: TEXT_LENGTH,
    });
  }
  if (spec.kind === 'order') {
    return strictObject('order', {
      type: 'array',
      items: { type: 'string', enum: spec.labels },
      minItems: spec.labels.length,
      maxItems: spec.labels.length,
    });
  }
  return strictObject('choice', { type: 'string', enum: spec.labels });
};

/** The strict schema the model must answer with: the response or an abort. */
export const answerSchema = (spec: ResponseSpec) => ({
  name: 'lab_quiz_answer',
  strict: true,
  schema: {
    anyOf: [
      responseSchema(spec),
      strictObject('abort', { type: 'string', maxLength: 200 }),
    ],
  },
});

const INSTRUCTIONS: Record<ResponseSpec['kind'], string> = {
  choice:
    'Reply with JSON only: {"choice": "<label>"} for the option that ' +
    'matches the prompt.',
  order:
    'Reply with JSON only: {"order": ["<label>", ...]} listing every ' +
    'option label exactly once, in the order the prompt asks for.',
  text:
    'Reply with JSON only: {"text": "<digits>"} with exactly the digits ' +
    'shown, left to right.',
};

const systemPrompt = (spec: ResponseSpec): string =>
  'You answer a visual quiz from a lab test fixture. The image shows the ' +
  `prompt and the quiz. ${INSTRUCTIONS[spec.kind]} If you cannot tell, ` +
  'reply {"abort": "<short reason>"}.';

const Answer = z.union([
  z.strictObject({ choice: z.string() }),
  z.strictObject({ order: z.array(z.string()).max(8) }),
  z.strictObject({ text: z.string().max(32) }),
  z.strictObject({ abort: z.string().max(200) }),
]);

const Completion = z.object({
  model: z.string().optional(),
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable() }) }))
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
    })
    .optional(),
});

const toDecision = (answer: z.infer<typeof Answer>): PlannerDecision => {
  if ('choice' in answer) return { kind: 'choice', label: answer.choice };
  if ('order' in answer) return { kind: 'order', labels: answer.order };
  if ('text' in answer) return { kind: 'text', text: answer.text };
  return { kind: 'abort', reason: answer.abort };
};

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
  plan: async ({ screenshot, prompt, response: spec }) => {
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
          json_schema: answerSchema(spec),
        },
        messages: [
          { role: 'system', content: systemPrompt(spec) },
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
      throw new PlannerError(`provider_status_${response.status}`);
    }

    const completion = Completion.safeParse(await response.json());
    if (!completion.success) throw new PlannerError('malformed_completion');
    const reported = completion.data.usage;
    const usage =
      reported === undefined
        ? undefined
        : {
            promptTokens: reported.prompt_tokens,
            completionTokens: reported.completion_tokens,
            totalTokens: reported.total_tokens,
          };

    const content = completion.data.choices[0]!.message.content;
    if (content === null) throw new PlannerError('no_content', usage);
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new PlannerError('answer_not_json', usage);
    }
    const answer = Answer.safeParse(parsed);
    if (!answer.success) throw new PlannerError('answer_off_schema', usage);
    const decision = toDecision(answer.data);
    if (!fitsSpec(decision, spec)) {
      throw new PlannerError('answer_outside_spec', usage);
    }

    return { decision, responseModel: completion.data.model, usage };
  },
});
