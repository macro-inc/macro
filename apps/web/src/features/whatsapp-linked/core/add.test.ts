import { ThrownResultError } from '@core/util/result';
import { describe, expect, it } from 'vitest';
import { decodeAddRefusal } from '../queries/decode';
import { addFailureMessage } from './add';

describe('adoption refusals', () => {
  it('reads DSS’s LinkedError codes, keeping its wording for rejected input', () => {
    expect(
      addFailureMessage(
        decodeAddRefusal(
          new ThrownResultError([{ code: 'forbidden', message: 'x' }])
        )
      )
    ).toBe(
      "Your WhatsApp isn't allowed to add this chat. Check that you're still in it."
    );
    expect(
      addFailureMessage(
        decodeAddRefusal(
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
      addFailureMessage(
        decodeAddRefusal(
          new ThrownResultError([{ code: 'NETWORK_ERROR', message: 'x' }])
        )
      )
    ).toBe("Couldn't reach Macro. Check your connection and try again.");
    expect(decodeAddRefusal(new TypeError('offline'))).toEqual({
      reason: 'unreachable',
    });
  });
});
