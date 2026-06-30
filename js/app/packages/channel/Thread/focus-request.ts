import { type Accessor, createSignal } from 'solid-js';

export type FocusRequest = {
  pending: Accessor<number | undefined>;
  request: () => void;
  consume: () => boolean;
};

export function createFocusRequest(): FocusRequest {
  const [pending, setPending] = createSignal<number | undefined>();
  let nextId = 0;

  return {
    pending,
    request: () => {
      nextId += 1;
      setPending(nextId);
    },
    consume: () => {
      if (pending() === undefined) return false;
      setPending(undefined);
      return true;
    },
  };
}
