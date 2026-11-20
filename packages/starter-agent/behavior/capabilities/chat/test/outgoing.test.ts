import { expect, test } from 'bun:test';
import { observeOutgoing } from '../outgoing.ts';

test('SDK wording is warned about on posts, replies and DMs without recording the message', async () => {
  const sent: string[] = [];
  const events: object[] = [];
  const posted = { channelId: 'channel', messageId: 'message' };
  const chat = observeOutgoing(
    {
      send: async (_channelId, text) => {
        sent.push(text);
        return posted;
      },
      reply: async (_channelId, _root, text) => {
        sent.push(text);
        return posted;
      },
      dm: async (_userId, text) => {
        sent.push(text);
        return posted;
      },
    },
    {
      event: async (stream, entry) => {
        events.push({ stream, ...entry });
      },
    },
    () => []
  );
  const text = 'I checked macro.email.links() and macro.email.inbox().';
  expect(await chat.send('channel', text)).toEqual(posted);
  expect(await chat.reply('channel', 'root', text)).toEqual(posted);
  expect(await chat.dm('macro|owner@example.com', text)).toEqual(posted);
  expect(sent).toEqual([text, text, text]);
  expect(events).toEqual([
    { stream: 'chat', kind: 'internal-wording', reasons: ['sdk-call'] },
    { stream: 'chat', kind: 'internal-wording', reasons: ['sdk-call'] },
    { stream: 'chat', kind: 'internal-wording', reasons: ['sdk-call'] },
  ]);
});

test('ordinary replies do not warn, and a failed warning cannot prevent a reply', async () => {
  const sent: string[] = [];
  let warnings = 0;
  const send = async (_to: string, text: string) => {
    sent.push(text);
    return { channelId: 'channel', messageId: 'message' };
  };
  const chat = observeOutgoing(
    {
      send,
      dm: send,
      reply: async (channel, _root, text) => send(channel, text),
    },
    {
      event: async () => {
        warnings += 1;
        throw new Error('log unavailable');
      },
    },
    () => []
  );
  const plain = 'I checked your inbox. I can open the browser next.';
  await chat.send('channel', plain);
  expect(warnings).toBe(0);
  const internal = 'I used code mode and RunCapabilityScript.';
  await chat.reply('channel', 'root', internal);
  expect(warnings).toBe(1);
  expect(sent).toEqual([plain, internal]);
});

/** The reasons a text is warned for, with the given catalog function names. */
const reasonsFor = async (
  text: string,
  toolNames: readonly string[] = []
): Promise<readonly string[]> => {
  const events: { reasons?: readonly string[] }[] = [];
  const send = async () => ({ channelId: 'channel', messageId: 'message' });
  const chat = observeOutgoing(
    { send, dm: send, reply: send },
    {
      event: async (_stream, entry) => {
        events.push(entry);
      },
    },
    () => toolNames
  );
  await chat.send('channel', text);
  return events.flatMap((event) => event.reasons ?? []);
};

test('ordinary prose about Macro is not internal wording', async () => {
  for (const text of [
    'Welcome to Macro. Let me know what you need.',
    'I use Macro.app on my laptop.',
    'Here it is: https://macro.com/app/md/0190a1b2',
    'Ask <m-user-mention>{"userId":"macro|ada@macro.com","email":"ada@macro.com"}</m-user-mention> about it.',
    'Write to ada@macro.com.',
    'We watched the Muppets last night.',
    'I posted your message in the channel.',
    'The meeting is at 4:05.',
  ])
    expect(await reasonsFor(text, ['postMessage', 'readEmailThread'])).toEqual(
      []
    );
});

test("the agent's own function names, from its catalog, are internal wording", async () => {
  expect(
    await reasonsFor('I will use readEmailThread to check.', [
      'postMessage',
      'readEmailThread',
    ])
  ).toEqual(['tool-name']);
  // Names are the catalog's, not a fixed list: an unknown one is not flagged.
  expect(await reasonsFor('I will use readEmailThread to check.', [])).toEqual(
    []
  );
});

test('raw errors and the runtime package are internal wording', async () => {
  for (const text of [
    'The request failed with HTTP 503.',
    'It answered with status code 404.',
    'Error: fetch failed',
    'It broke at loadThread (/home/macro/agent/workspace/x.ts:12:3).',
  ])
    expect(await reasonsFor(text)).toEqual(['raw-error']);
  expect(await reasonsFor('That lives in @macro-inc/muppet/core.')).toEqual([
    'execution-details',
  ]);
  expect(await reasonsFor('I checked macro.email.inbox().')).toEqual([
    'sdk-call',
  ]);
});
