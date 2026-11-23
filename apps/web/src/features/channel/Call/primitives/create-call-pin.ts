import { beginInteraction } from '@app/observability/flow';
import { type Accessor, createMemo } from 'solid-js';
import { createStore, produce, unwrap } from 'solid-js/store';
import { activeCallPin, type CallPin, sameCallPin } from '../core/call-layout';

type PinState<T extends object> = {
  pin?: CallPin<T>;
  revision: number;
  callId: string | null;
};
type ActivePin<T extends object> = { revision: number; pin?: CallPin<T> };

/** Call-owned selection survives stage unmounts, but not a call or source ending. */
export function createCallPin<T extends object>(options: {
  callId: Accessor<string | null>;
  participants: Accessor<readonly T[]>;
  screens: Accessor<readonly T[]>;
  screenSharing: Accessor<boolean>;
}) {
  const [state, setState] = createStore<PinState<T>>({
    revision: 0,
    callId: null,
  });
  const selected = createMemo<ActivePin<T>>((previous) => {
    const revision = state.revision;
    // Once a source disappears, the same selection stays retired on reconnect.
    if (previous?.revision === revision && !previous.pin) return previous;
    const sameCall = state.callId === options.callId();
    return {
      revision,
      pin: sameCall
        ? activeCallPin(
            unwrap(state.pin),
            options.participants(),
            options.screens(),
            options.screenSharing()
          )
        : undefined,
    };
  });
  const activePin = () => selected().pin;
  const togglePin = (target: CallPin<T>) => {
    const interaction = beginInteraction('call.pin');
    try {
      const pin = sameCallPin(activePin(), target) ? undefined : target;
      setState(
        produce((state) => {
          state.pin = pin;
          state.revision += 1;
          state.callId = options.callId();
        })
      );
    } finally {
      interaction.end();
    }
  };
  return { activePin, togglePin };
}
