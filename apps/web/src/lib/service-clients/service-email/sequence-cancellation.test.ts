import { describe, expect, it, vi } from 'vitest';
import { cancelSequenceDraft } from './sequence-cancellation';

const request = vi.hoisted(() => vi.fn());
vi.mock('@core/util/fetchWithToken', () => ({ fetchWithToken: request }));
describe('scheduled cancellation response', () => {
  it('distinguishes the actual backend delivery conflict from other bad requests', async () => {
    cancelSequenceDraft('inbox', 'draft');
    const handler = request.mock.calls[0][1].errorResponseHandler;
    const delivered = await handler(
      new Response(
        JSON.stringify({
          message:
            'Message with id 00000000-0000-0000-0000-000000000001 is scheduled, processing, or already sent',
        }),
        { status: 400 }
      )
    );
    expect(delivered.code).toBe('DELIVERY_STARTED');
    const invalid = await handler(
      new Response(JSON.stringify({ message: 'Invalid schedule' }), {
        status: 400,
      })
    );
    expect(invalid.code).not.toBe('DELIVERY_STARTED');
    expect(request.mock.calls[0][1].headers).toEqual({
      'X-Email-Link-Id': 'inbox',
    });
  });
});
