import { ok } from 'neverthrow';
import { expect, it, vi } from 'vitest';

const fetchWithToken = vi.hoisted(() => vi.fn());
vi.mock('@core/util/fetchWithToken', () => ({ fetchWithToken }));

import { computersClient } from './computers';

it('reads a 503 from offers as computers being unavailable', async () => {
  fetchWithToken.mockResolvedValue(ok([]));
  await computersClient.offers();
  const handler = fetchWithToken.mock.calls[0][1].errorResponseHandler;

  expect(
    await handler(
      new Response(JSON.stringify({ message: 'computers are not available' }), {
        status: 503,
      })
    )
  ).toEqual({
    code: 'COMPUTERS_UNAVAILABLE',
    message: "Computers aren't available right now. Try again later.",
  });
});
