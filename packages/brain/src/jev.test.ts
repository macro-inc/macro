import { assertEquals, assertThrows } from '@std/assert';
import {
  fitBody,
  isRelevant,
  JevConfigError,
  judge,
  MAX_BODY_BYTES,
  parseJevConfig,
} from './jev.ts';
import type { DecideRequest } from './macro.ts';

const CONFIG = parseJevConfig({
  threshold: 0.6,
  questions: {
    addressed_to_me: 'Is this addressed to Ada?',
    about_my_job: 'Is this about invoices?',
    needs_response: 'Does this ask for something?',
  },
  rule: 'relevant if addressed_to_me, or about_my_job and needs_response',
  wakeIf: [['addressed_to_me'], ['about_my_job', 'needs_response']],
});

const MESSAGE = {
  id: 'message-2',
  from: 'macro|bo@example.com',
  at: '2026-11-04T10:00:00Z',
  text: 'the March invoice is wrong, can someone fix it?',
  thread: null,
};

Deno.test('a message is relevant when every question of one wakeIf group clears the threshold', () => {
  assertEquals(
    isRelevant(CONFIG, {
      addressed_to_me: 0.1,
      about_my_job: 0.9,
      needs_response: 0.7,
    }),
    true
  );
  assertEquals(
    isRelevant(CONFIG, {
      addressed_to_me: 0.1,
      about_my_job: 0.9,
      needs_response: 0.2,
    }),
    false
  );
  assertEquals(isRelevant(CONFIG, { about_my_job: 0.9 }), false);
});

Deno.test('a wakeIf group naming an unknown question is refused', () => {
  assertThrows(
    () =>
      parseJevConfig({
        threshold: 0.6,
        questions: { addressed_to_me: 'Is this for Ada?' },
        rule: 'addressed',
        wakeIf: [['addressed_to_ada']],
      }),
    JevConfigError,
    'wakeIf names unknown question "addressed_to_ada"'
  );
});

Deno.test('an @mention wakes without asking the model, and the decision is logged', async () => {
  const logged: object[] = [];
  const decision = await judge(
    {
      messageId: 'message-1',
      channel: 'billing',
      mentionsMe: true,
      directMessage: false,
      inMyThread: false,
      message: MESSAGE,
      recent: [],
    },
    {
      config: async () => CONFIG,
      decide: () => {
        throw new Error('decide must not be called for a mention');
      },
      log: async (line) => {
        logged.push(line);
      },
      now: () => new Date('2026-11-04T10:00:01Z'),
    }
  );

  assertEquals(decision, {
    relevant: true,
    reason: 'mentioned',
    probabilities: {},
  });
  assertEquals(logged, [
    {
      at: '2026-11-04T10:00:01.000Z',
      message_id: 'message-1',
      relevant: true,
      reason: 'mentioned',
      p: {},
    },
  ]);
});

Deno.test('a failed decide retries with the last two messages, then falls back to "in my thread"', async () => {
  const requests: DecideRequest[] = [];
  const recent = [
    { ...MESSAGE, id: 'message-a' },
    { ...MESSAGE, id: 'message-b' },
    { ...MESSAGE, id: 'message-c' },
  ];

  const decision = await judge(
    {
      messageId: 'message-2',
      channel: 'billing',
      mentionsMe: false,
      directMessage: false,
      inMyThread: true,
      message: MESSAGE,
      recent,
    },
    {
      config: async () => CONFIG,
      decide: async (request) => {
        requests.push(request);
        throw new Error('HTTP 400');
      },
      log: async () => {},
    }
  );

  assertEquals(decision, {
    relevant: true,
    reason: 'in_my_thread',
    probabilities: {},
  });
  assertEquals(
    requests.map((request) =>
      (
        request.input as { recent_messages: { id: string }[] }
      ).recent_messages.map((message) => message.id)
    ),
    [
      ['message-a', 'message-b', 'message-c'],
      ['message-b', 'message-c'],
    ]
  );
});

Deno.test('fitBody drops the oldest context until the request fits', () => {
  const long = 'x'.repeat(40_000);
  const request = fitBody({
    input: {
      channel: 'billing',
      direct_message: false,
      recent_messages: [
        { ...MESSAGE, id: 'oldest', text: long },
        { ...MESSAGE, id: 'middle', text: long },
        { ...MESSAGE, id: 'newest', text: 'short' },
      ],
      new_message: MESSAGE,
    },
    questions: CONFIG.questions,
  });

  const kept = (request.input as { recent_messages: { id: string }[] })
    .recent_messages;
  assertEquals(
    kept.map((message) => message.id),
    ['middle', 'newest']
  );
  assertEquals(JSON.stringify(request).length <= MAX_BODY_BYTES, true);
});
