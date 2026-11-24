import { deepEqual } from '@core/util/compareUtils';
import { thrownResultErrorHasCode } from '@core/util/result';

/** The code a send fails with when the server could not say whether it has it. */
const DELIVERY_UNKNOWN = 'DELIVERY_UNKNOWN';

/** How many restored drafts of unknown delivery keep their ids. */
const KEPT = 20;

/**
 * Who sends a message and where it goes (every field but `message`), plus
 * what it says.
 */
type UncertainSend = Readonly<Record<string, unknown>> & {
  message: { readonly mentions?: readonly unknown[] };
};

/**
 * The send as compared: a draft rebuilt from storage lists its mentions in
 * the order the editor recreates them, which says nothing new.
 */
function canonical(send: UncertainSend): UncertainSend {
  const mentions = send.message.mentions;
  if (!mentions) return send;
  const sorted = [...mentions].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b))
  );
  return { ...send, message: { ...send.message, mentions: sorted } };
}

const samePlace = (a: UncertainSend, b: UncertainSend) =>
  deepEqual({ ...a, message: undefined }, { ...b, message: undefined });

/**
 * Remembers sends whose delivery could not be confirmed and whose draft came
 * back to the composer, so sending that draft again reuses its id: the server
 * answers a send it already has without writing it twice, while a fresh id
 * would post it again. A send is keyed by who sends it, where it goes and
 * what it says. Only the next send to that place can be the retry: once
 * something else is sent there, the same words sent later are a new message.
 */
export function createUncertainSends(newId: () => string) {
  let uncertain: { send: UncertainSend; id: string }[] = [];
  return {
    /** The id to send `send` under. */
    idFor(send: UncertainSend): string {
      const key = canonical(send);
      const entry = uncertain.find((e) => deepEqual(e.send, key));
      uncertain = uncertain.filter((e) => !samePlace(e.send, key));
      return entry?.id ?? newId();
    },
    /** Notes a failed send whose draft the composer shows again. */
    restored(send: UncertainSend, id: string, error: unknown) {
      if (!thrownResultErrorHasCode(error, DELIVERY_UNKNOWN)) return;
      const key = structuredClone(canonical(send));
      uncertain = [
        ...uncertain.filter((entry) => !deepEqual(entry.send, key)),
        { send: key, id },
      ].slice(-KEPT);
    },
  };
}
