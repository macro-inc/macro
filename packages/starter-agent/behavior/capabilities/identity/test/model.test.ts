import { expect, test } from 'bun:test';
import type { GreetingModel } from '@macro-inc/muppet/utilities/greeting';
import type { PeopleClaude } from '../../people/ask.ts';
import {
  directModel,
  eitherModel,
  type SessionMessage,
  type StreamingQuery,
  warmClaude,
} from '../model.ts';

const upstream = {
  url: 'http://127.0.0.1:4100/anthropic/',
  token: 'relay-capability',
};

test('in credits mode the model is one request to the gateway, and its spend goes on the ledger', async () => {
  const requests: Request[] = [];
  const spent: object[] = [];
  const model = directModel({
    upstream,
    fetch: async (request) => {
      requests.push(request);
      return Response.json({
        content: [{ type: 'text', text: 'Hi Maya.' }],
        usage: { input_tokens: 1_000, output_tokens: 100 },
      });
    },
    model: 'claude-haiku-4-5-20251001',
    timeoutMs: 60_000,
    spend: async (entry) => {
      spent.push(entry);
    },
    spendEvent: 'identity.greeting',
  });
  expect(requests).toEqual([]);
  expect(await model.answer('Write a hello.')).toBe('Hi Maya.');
  const [request] = requests;
  expect(request?.url).toBe('http://127.0.0.1:4100/anthropic/v1/messages');
  expect(request?.method).toBe('POST');
  expect(request?.headers.get('authorization')).toBe('Bearer relay-capability');
  expect(request?.headers.get('anthropic-version')).toBe('2023-06-01');
  expect(await request?.json()).toEqual({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{ role: 'user', content: 'Write a hello.' }],
  });
  expect(spent).toEqual([{ event: 'identity.greeting', cost_usd: 0.0015 }]);
});

test('a gateway that refuses fails the answer', async () => {
  const model = directModel({
    upstream,
    fetch: async () => new Response('no', { status: 402 }),
    model: 'claude-haiku-4-5-20251001',
    timeoutMs: 60_000,
    spend: async () => {},
    spendEvent: 'identity.greeting',
  });
  await expect(model.answer('Write a hello.')).rejects.toThrow('402');
});

const claudeRuns = (spent: object[]): PeopleClaude => ({
  executable: () => 'claude',
  environment: async () => ({ PATH: '/bin' }),
  sandbox: {
    argv: [],
    spawn: () => {
      throw new Error('no spawn in a test');
    },
  },
  spend: async (entry) => {
    spent.push(entry);
  },
});

/**
 * A stand-in for the SDK: records when the session starts, reads the
 * prompt's messages as they stream in, and answers each with a result.
 */
const fakeSession = () => {
  const events: string[] = [];
  let markStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let markEnded: () => void = () => {};
  const ended = new Promise<void>((resolve) => {
    markEnded = resolve;
  });
  const query: StreamingQuery = ({ prompt, options }) => {
    events.push(`started with thinking ${JSON.stringify(options?.thinking)}`);
    markStarted();
    return (async function* (): AsyncGenerator<SessionMessage> {
      for await (const message of prompt) {
        const content = message.message.content;
        events.push(`asked ${typeof content === 'string' ? content : '?'}`);
        yield {
          type: 'result',
          subtype: 'success',
          result: 'Hi Maya.',
          total_cost_usd: 0.001,
          session_id: 's-1',
        };
      }
      markEnded();
    })();
  };
  return { query, events, started, ended };
};

test('on a Claude plan, Claude Code starts before it is asked, and answers what streams in', async () => {
  const session = fakeSession();
  const spent: object[] = [];
  const model = warmClaude({
    query: session.query,
    claude: claudeRuns(spent),
    model: 'claude-haiku-4-5-20251001',
    timeoutMs: 60_000,
    spendEvent: 'identity.greeting',
  });
  // Started (spawning, signing in) while nothing has been asked yet.
  await session.started;
  expect(session.events).toEqual(['started with thinking {"type":"disabled"}']);
  expect(await model.answer('Write a hello.')).toBe('Hi Maya.');
  expect(session.events.at(-1)).toBe('asked Write a hello.');
  expect(spent).toEqual([
    { event: 'identity.greeting', cost_usd: 0.001, session_id: 's-1' },
  ]);
  model.cancel();
});

test('a warm session that is dropped unasked ends without asking anything', async () => {
  const session = fakeSession();
  const model = warmClaude({
    query: session.query,
    claude: claudeRuns([]),
    model: 'claude-haiku-4-5-20251001',
    timeoutMs: 60_000,
    spendEvent: 'identity.greeting',
  });
  model.cancel();
  // The session reads its prompt to the end and stops.
  await session.ended;
  expect(session.events.filter((event) => event.startsWith('asked'))).toEqual(
    []
  );
});

const named = (
  name: string,
  calls: string[],
  cancelled: () => void = () => {}
): GreetingModel => ({
  answer: async (prompt) => {
    calls.push(`${name} ${prompt}`);
    return name;
  },
  cancel: () => {
    calls.push(`${name} cancelled`);
    cancelled();
  },
});

test('the direct call is used when there is a gateway, warm Claude Code when there is not', async () => {
  const calls: string[] = [];
  const credits = eitherModel(async () => upstream, {
    direct: () => named('direct', calls),
    warm: () => named('warm', calls),
  });
  expect(await credits.answer('hi')).toBe('direct');
  let markCancelled: () => void = () => {};
  const cancelled = new Promise<void>((resolve) => {
    markCancelled = resolve;
  });
  const plan = eitherModel(async () => undefined, {
    direct: () => named('direct', calls),
    warm: () => named('warm', calls, markCancelled),
  });
  expect(await plan.answer('hi')).toBe('warm');
  plan.cancel();
  await cancelled;
  expect(calls).toEqual(['direct hi', 'warm hi', 'warm cancelled']);
});
