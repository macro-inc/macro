import { assertEquals } from '@std/assert';
import { type Control, controlHandler, TOKEN_HEADER } from './control.ts';

const HEALTH = {
  status: 'ok' as const,
  startedAt: '2026-11-04T10:00:00Z',
  connected: true,
  lastEventAt: null,
  turns: [],
  work: [],
  spentTodayUsd: 0,
  problems: [],
};

/** Every route a test does not exercise fails loudly. */
const unused = () => {
  throw new Error('not used in this test');
};

const CONTROL: Control = {
  health: async () => HEALTH,
  post: unused,
  reply: unused,
  context: unused,
  handoff: unused,
  remember: unused,
  recall: unused,
  forget: unused,
  focus: unused,
  promise: unused,
  release: unused,
  schedule: unused,
  schedules: unused,
  unschedule: unused,
  secret: unused,
};

Deno.test('health needs no token; everything else does', async () => {
  const handler = controlHandler(CONTROL, 'token-1', () => {});

  const health = await handler(new Request('http://127.0.0.1:7801/health'));
  const forbidden = await handler(
    new Request('http://127.0.0.1:7801/secrets/github', {
      headers: { [TOKEN_HEADER]: 'guess' },
    })
  );

  assertEquals(health.status, 200);
  assertEquals(await health.json(), HEALTH);
  assertEquals(forbidden.status, 403);
});

Deno.test('a reply goes to the brain with the turn that sent it', async () => {
  const replies: unknown[][] = [];
  const handler = controlHandler(
    {
      ...CONTROL,
      reply: async (...args) => {
        replies.push(args);
        return { id: 'message-9' };
      },
    },
    'token-1',
    () => {}
  );

  const response = await handler(
    new Request('http://127.0.0.1:7801/talk/reply', {
      method: 'POST',
      headers: { [TOKEN_HEADER]: 'token-1' },
      body: JSON.stringify({
        turn: 'respond-1',
        channel: 'channel-1',
        root: 'root-1',
        text: 'on it',
      }),
    })
  );

  assertEquals(await response.json(), { id: 'message-9' });
  assertEquals(replies, [['respond-1', 'channel-1', 'root-1', 'on it']]);
});

Deno.test('a malformed schedule is a 400 that says what is expected', async () => {
  const handler = controlHandler(CONTROL, 'token-1', () => {});

  const response = await handler(
    new Request('http://127.0.0.1:7801/schedules', {
      method: 'POST',
      headers: { [TOKEN_HEADER]: 'token-1' },
      body: JSON.stringify({ note: 'check in', trigger: { type: 'daily' } }),
    })
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    error:
      'trigger must be {type:"cron",schedule,timezone} or {type:"once",at}',
  });
});
