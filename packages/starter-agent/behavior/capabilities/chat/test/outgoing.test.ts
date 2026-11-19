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
    }
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
    }
  );
  const plain = 'I checked your inbox. I can open the browser next.';
  await chat.send('channel', plain);
  expect(warnings).toBe(0);
  const internal = 'I used code mode and RunCapabilityScript.';
  await chat.reply('channel', 'root', internal);
  expect(warnings).toBe(1);
  expect(sent).toEqual([plain, internal]);
});
