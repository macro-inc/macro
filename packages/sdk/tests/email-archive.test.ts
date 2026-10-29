import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import type { ArchiveThreadsRequest } from '../generated/email/types.gen';
import { Macro } from '../src/macro';

afterEach(() => mock.restore());

test('archiving many threads sends one request per 100 and resolves to the threads that did not change', async () => {
  const bodies: ArchiveThreadsRequest[] = [];
  const fetchMock = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      const request = input instanceof Request ? input : new Request(input);
      expect(request.method).toBe('PATCH');
      expect(new URL(request.url).pathname).toBe('/email/threads/archived');
      const body = (await request.json()) as ArchiveThreadsRequest;
      bodies.push(body);
      return Response.json({
        updated_thread_ids: body.thread_ids.filter((id) => id !== 'thread-7'),
        failed_thread_ids: body.thread_ids.filter((id) => id === 'thread-7'),
      });
    },
    { preconnect: globalThis.fetch.preconnect },
  );
  spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
  const macro = new Macro({
    auth: { type: 'user', apiKey: 'mak_test' },
    hosts: { email: 'https://email.example.test' },
  });
  const threads = Array.from({ length: 101 }, (_, index) =>
    macro.email.byId(`thread-${index}`),
  );

  const unchanged = await macro.email.archive(threads, false);

  expect(bodies).toEqual([
    {
      thread_ids: threads.slice(0, 100).map((thread) => thread.id),
      value: false,
    },
    { thread_ids: ['thread-100'], value: false },
  ]);
  expect(unchanged).toEqual([threads[7]]);
});
