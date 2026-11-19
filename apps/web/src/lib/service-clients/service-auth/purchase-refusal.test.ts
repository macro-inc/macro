import { describe, expect, it } from 'vitest';
import { readPurchaseRefusal } from './purchase-refusal';

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('readPurchaseRefusal', () => {
  it('reads each shared refusal code as the client code, keeping the message', async () => {
    expect(
      await readPurchaseRefusal(
        respond(402, { message: 'Declined', code: 'payment_declined' })
      )
    ).toEqual({ code: 'PAYMENT_DECLINED', message: 'Declined' });
    expect(
      await readPurchaseRefusal(
        respond(409, { message: 'No room', code: 'no_room', size: 'xl' })
      )
    ).toEqual({ code: 'NO_ROOM', message: 'No room' });
    expect(
      await readPurchaseRefusal(
        respond(403, { message: 'Trial', code: 'team_on_trial' })
      )
    ).toEqual({ code: 'TEAM_ON_TRIAL', message: 'Trial' });
    expect(
      await readPurchaseRefusal(
        respond(409, { message: 'Busy', code: 'invite_in_progress' })
      )
    ).toEqual({ code: 'INVITE_IN_PROGRESS', message: 'Busy' });
  });

  it('leaves bodies without a shared code, and the response body, to the caller', async () => {
    const response = respond(409, { message: 'Sold out' });
    expect(await readPurchaseRefusal(response)).toBeUndefined();
    expect(await response.json()).toEqual({ message: 'Sold out' });
    expect(
      await readPurchaseRefusal(new Response('not json', { status: 500 }))
    ).toBeUndefined();
  });
});
