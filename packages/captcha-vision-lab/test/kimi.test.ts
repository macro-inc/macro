/**
 * The Kimi adapter against the loopback stand-in only: no provider is called.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';
import { kimiPlanner } from '../src/planner.ts';
import { generateShapesQuiz, seededRandom } from '../src/quiz.ts';
import { KIMI_MODEL, LAB_URL } from '../src/registry.ts';
import { runChallenge } from '../src/run.ts';
import { createLab, serveLab } from '../src/server.ts';
import {
  fixedChoiceReply,
  type StandIn,
  startStandIn,
} from '../src/stand-in.ts';

const SEED = 918273645;
const LABELS = ['A', 'B', 'C', 'D'];
const SCREENSHOT = Uint8Array.of(137, 80, 78, 71, 1, 2, 3);
const INPUT = {
  screenshot: SCREENSHOT,
  prompt: 'Pick the option where the red circle is above the blue square.',
  labels: LABELS,
};

let standIn: StandIn | undefined;

afterEach(async () => {
  await standIn?.stop();
  standIn = undefined;
});

const completion = (content: string) => ({
  status: 200,
  body: { model: 'stand-in', choices: [{ message: { content } }] },
});

describe('the Kimi adapter', () => {
  test('sends only the prompt, the screenshot and the answer schema', async () => {
    standIn = startStandIn(() => fixedChoiceReply('C'));
    const planner = kimiPlanner({
      baseUrl: standIn.baseUrl,
      apiKey: 'stand-in-key',
    });

    const result = await planner.plan(INPUT);

    expect(result.decision).toEqual({ kind: 'choice', label: 'C' });
    expect(result.usage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
    expect(standIn.requests).toHaveLength(1);
    const request = standIn.requests[0] as Record<string, unknown>;
    expect(Object.keys(request).sort()).toEqual(
      [
        'max_tokens',
        'messages',
        'model',
        'reasoning_effort',
        'response_format',
        'temperature',
      ].sort()
    );
    expect(request.model).toBe(KIMI_MODEL);
    expect(request.reasoning_effort).toBe('none');
    expect(request.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'lab_quiz_answer',
        strict: true,
        schema: {
          anyOf: [
            {
              type: 'object',
              properties: { choice: { type: 'string', enum: LABELS } },
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
      },
    });
    const messages = request.messages as { role: string; content: unknown }[];
    expect(messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(messages[1]!.content).toEqual([
      { type: 'text', text: INPUT.prompt },
      {
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${Buffer.from(SCREENSHOT).toString('base64')}`,
        },
      },
    ]);
  });

  const malformed: [string, { status: number; body: unknown }][] = [
    ['an HTTP error', { status: 500, body: { error: 'boom' } }],
    ['non-JSON content', completion('the answer is C')],
    ['a label not on the page', completion('{"choice":"E"}')],
    ['extra fields', completion('{"choice":"C","x":1,"y":2}')],
    ['coordinates instead of a choice', completion('{"x":120,"y":40}')],
    ['no choices', { status: 200, body: { choices: [] } }],
  ];

  for (const [name, reply] of malformed) {
    test(`${name} is a closed failure`, async () => {
      standIn = startStandIn(() => reply);
      const planner = kimiPlanner({
        baseUrl: standIn.baseUrl,
        apiKey: 'stand-in-key',
      });

      await expect(planner.plan(INPUT)).rejects.toThrow();
    });
  }

  test('an abort is passed through as an abort', async () => {
    standIn = startStandIn(() => completion('{"abort":"cannot tell"}'));
    const planner = kimiPlanner({
      baseUrl: standIn.baseUrl,
      apiKey: 'stand-in-key',
    });

    expect((await planner.plan(INPUT)).decision).toEqual({
      kind: 'abort',
      reason: 'cannot tell',
    });
  });
});

describe('a lab run with the Kimi adapter on the stand-in', () => {
  let server: ReturnType<typeof serveLab>;
  let lab = createLab();

  beforeAll(() => {
    server = serveLab((request) => lab.fetch(request));
  });

  afterAll(async () => {
    await server.stop(true);
  });

  const run = (planner: ReturnType<typeof kimiPlanner>) => {
    const sessionNonce = crypto.randomUUID();
    const issued = lab.issue(sessionNonce);
    return runChallenge({
      lab,
      planner,
      runId: issued.runId,
      challengeId: issued.challengeId,
      capabilityId: issued.capabilityId,
      capability: issued.capability,
      sessionNonce,
      targetUrl: LAB_URL,
      executablePath: process.env.LAB_CHROMIUM_PATH,
    });
  };

  test('a screenshot goes out, one choice comes back and the server scores it', async () => {
    lab = createLab({ random: seededRandom(SEED) });
    const quiz = generateShapesQuiz(seededRandom(SEED));
    const correct = LABELS[quiz.options.findIndex((option) => option.correct)]!;
    standIn = startStandIn(() => fixedChoiceReply(correct));

    const record = await run(
      kimiPlanner({ baseUrl: standIn.baseUrl, apiKey: 'stand-in-key' })
    );

    expect(record.outcome).toBe('solved');
    expect(record.provider).toBe('kimi');
    expect(record.model).toBe(KIMI_MODEL);
    expect(record.responseModel).toBe('stand-in');
    expect(record.usage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
    expect(record.timings.plannerMs).toBeNumber();
    expect(standIn.requests).toHaveLength(1);

    const request = standIn.requests[0] as { messages: { content: unknown }[] };
    const [text, image] = request.messages[1]!.content as [
      { text: string },
      { image_url: { url: string } },
    ];
    expect(text.text).toBe(quiz.prompt);
    const png = Buffer.from(
      image.image_url.url.replace('data:image/png;base64,', ''),
      'base64'
    );
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');

    const sent = JSON.stringify(request);
    expect(sent).not.toContain(String(SEED));
    expect(sent.toLowerCase()).not.toMatch(/data-lab-option|correct|seed/);
    expect(sent).not.toContain('stand-in-key');
    expect(JSON.stringify(record)).not.toContain('stand-in-key');
  });

  test('malformed model output takes no action', async () => {
    lab = createLab();
    standIn = startStandIn(() => completion('{"x":120,"y":40}'));

    const record = await run(
      kimiPlanner({ baseUrl: standIn.baseUrl, apiKey: 'stand-in-key' })
    );

    expect(record.outcome).toBe('model_error');
    expect(record.plannerCalls).toBe(1);
    expect(record.actions).toHaveLength(0);
    expect(lab.stats().submissions).toBe(0);
  });
});
