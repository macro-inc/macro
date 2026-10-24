import { ThrownResultError } from '@core/util/result';
import { describe, expect, it } from 'vitest';
import { decodeAdoptRefusal } from '../queries/decode';
import { adoptFailureMessage } from './adopt';

describe('adoption refusals', () => {
  it('reads DSS’s LinkedError codes, keeping its wording for rejected input', () => {
    expect(
      adoptFailureMessage(
        decodeAdoptRefusal(
          new ThrownResultError([{ code: 'forbidden', message: 'x' }])
        )
      )
    ).toBe(
      "Your WhatsApp isn't allowed to add this chat. Check that you're still in it."
    );
    expect(
      adoptFailureMessage(
        decodeAdoptRefusal(
          new ThrownResultError([
            {
              code: 'invalid_input',
              message: 'groups with disappearing messages cannot be added',
            },
          ])
        )
      )
    ).toBe(
      "WhatsApp didn't accept this chat: groups with disappearing messages cannot be added."
    );
    expect(
      adoptFailureMessage(
        decodeAdoptRefusal(
          new ThrownResultError([{ code: 'NETWORK_ERROR', message: 'x' }])
        )
      )
    ).toBe("Couldn't reach Macro. Check your connection and try again.");
    expect(decodeAdoptRefusal(new TypeError('offline'))).toEqual({
      reason: 'unreachable',
    });
  });
});
