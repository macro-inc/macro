import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import type { ThreadReadReceipts } from '../generated/email/types.gen';
import { EmailMessage } from '../src/entities/email/message';
import { Macro } from '../src/macro';

afterEach(() => mock.restore());

const threadId = '0198a4cc-e138-7670-a308-a6b766602710';
const receipts: ThreadReadReceipts = {
  receipts: [
    {
      message_id: '0198a4cc-e138-7670-a308-a6b766602711',
      open_count: 2,
      first_opened_at: '2026-10-20T09:15:00Z',
      last_opened_at: '2026-10-21T16:40:00Z',
    },
    {
      message_id: '0198a4cc-e138-7670-a308-a6b766602712',
      open_count: 0,
      first_opened_at: null,
      last_opened_at: null,
    },
  ],
};

test('thread read receipts return message handles with camelCase fields', async () => {
  const requests: Request[] = [];
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request);
        return Response.json(receipts);
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const macro = new Macro({
    auth: { type: 'user', apiKey: 'mak_test' },
    hosts: { email: 'https://email.example.test' },
  });

  const result = await macro.email.byId(threadId).readReceipts();

  expect(new URL(requests[0].url).pathname).toBe(
    `/email/threads/${threadId}/read-receipts`,
  );
  expect(result.every((r) => r.message instanceof EmailMessage)).toBe(true);
  expect(result.map((r) => r.message.id)).toEqual([
    '0198a4cc-e138-7670-a308-a6b766602711',
    '0198a4cc-e138-7670-a308-a6b766602712',
  ]);
  expect(result[0]).toMatchObject({
    openCount: 2,
    firstOpenedAt: '2026-10-20T09:15:00Z',
    lastOpenedAt: '2026-10-21T16:40:00Z',
  });
  expect(result[1].openCount).toBe(0);
  expect(result[1].firstOpenedAt).toBeUndefined();
  expect(result[1].lastOpenedAt).toBeUndefined();
});
