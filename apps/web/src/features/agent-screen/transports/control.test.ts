import { describe, expect, it } from 'vitest';
import { parseServerMessage } from './control';

describe('parseServerMessage', () => {
  it('keeps a state whose driver has no profile name, and one bad field does not drop the frame', () => {
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'state',
          driver: { userId: 'macro|alice@example.test', name: null },
          agentHeld: true,
          waking: false,
          transport: 'vnc',
          viewers: 2,
        })
      )
    ).toEqual({
      type: 'state',
      driver: { userId: 'macro|alice@example.test', name: null },
      agentHeld: true,
      waking: false,
      transport: 'vnc',
      viewers: 2,
    });

    // A field the viewer can do without arrives wrong: it falls back, the
    // driver still comes through.
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'state',
          driver: { userId: 'macro|alice@example.test', name: 42 },
          agentHeld: 'yes',
          transport: 'vnc',
          viewers: null,
        })
      )
    ).toEqual({
      type: 'state',
      driver: { userId: 'macro|alice@example.test', name: null },
      agentHeld: false,
      waking: false,
      transport: 'vnc',
      viewers: 0,
    });
  });

  it('parses the errors a running computer ends with when its screen is gone', () => {
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'error',
          code: 'tunnelFailed',
          message: 'screen unreachable',
        })
      )
    ).toEqual({
      type: 'error',
      code: 'tunnelFailed',
      message: 'screen unreachable',
    });
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'error',
          code: 'sourceUnavailable',
          message: 'display closed',
        })
      )
    ).toEqual({
      type: 'error',
      code: 'sourceUnavailable',
      message: 'display closed',
    });
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'error',
          code: 'tooManySockets',
          message: 'too many sockets',
        })
      )
    ).toEqual({
      type: 'error',
      code: 'tooManySockets',
      message: 'too many sockets',
    });
  });
});
