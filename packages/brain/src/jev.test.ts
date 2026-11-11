import assert from 'node:assert/strict';
import { test } from 'node:test';
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
test('a message is relevant when every question of one wakeIf group clears the threshold', () => {
  assert.deepEqual(
    isRelevant(CONFIG, {
      addressed_to_me: 0.1,
      about_my_job: 0.9,
      needs_response: 0.7,
    }),
    true
  );
  assert.deepEqual(
    isRelevant(CONFIG, {
      addressed_to_me: 0.1,
      about_my_job: 0.9,
      needs_response: 0.2,
    }),
    false
  );
  assert.deepEqual(isRelevant(CONFIG, { about_my_job: 0.9 }), false);
});
test('a wakeIf group naming an unknown question is refused', () => {
  assert.throws(
    () =>
      parseJevConfig({
        threshold: 0.6,
        questions: { addressed_to_me: 'Is this for Ada?' },
        rule: 'addressed',
        wakeIf: [['addressed_to_ada']],
      }),
    (error: unknown) =>
      error instanceof JevConfigError &&
      error.message.includes('wakeIf names unknown question "addressed_to_ada"')
  );
});
test('an @mention wakes without asking the model, and the decision is logged', async () => {
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
  assert.deepEqual(decision, {
    relevant: true,
    reason: 'mentioned',
    probabilities: {},
  });
  assert.deepEqual(logged, [
    {
      at: '2026-11-04T10:00:01.000Z',
      message_id: 'message-1',
      relevant: true,
      reason: 'mentioned',
      p: {},
    },
  ]);
});
test('a failed decide retries with the last two messages, then falls back to "in my thread"', async () => {
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
  assert.deepEqual(decision, {
    relevant: true,
    reason: 'in_my_thread',
    probabilities: {},
  });
  assert.deepEqual(
    requests.map((request) =>
      (
        request.input as {
          recent_messages: {
            id: string;
          }[];
        }
      ).recent_messages.map((message) => message.id)
    ),
    [
      ['message-a', 'message-b', 'message-c'],
      ['message-b', 'message-c'],
    ]
  );
});
test('fitBody drops the oldest context until the request fits', () => {
  const long = 'x'.repeat(40000);
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
  const kept = (
    request.input as {
      recent_messages: {
        id: string;
      }[];
    }
  ).recent_messages;
  assert.deepEqual(
    kept.map((message) => message.id),
    ['middle', 'newest']
  );
  assert.deepEqual(JSON.stringify(request).length <= MAX_BODY_BYTES, true);
});
