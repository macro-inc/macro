import { deepEqual } from '@core/util/compareUtils';
import { thrownResultErrorHasCode } from '@core/util/result';

/** The code a send fails with when the server could not say whether it has it. */
const DELIVERY_UNKNOWN = 'DELIVERY_UNKNOWN';

/** How many restored drafts of unknown delivery keep their ids. */
const KEPT = 20;

/**
 * Remembers sends whose delivery could not be confirmed and whose draft came
 * back to the composer, so sending that draft again reuses its id: the server
 * answers a send it already has without writing it twice, while a fresh id
 * would post it again. A send is keyed by who sends it, where it goes and
 * what it says.
 */
export function createUncertainSends(newId: () => string) {
  let uncertain: { send: unknown; id: string }[] = [];
  return {
    /** The id to send `send` under. */
    idFor(send: unknown): string {
      const index = uncertain.findIndex((entry) => deepEqual(entry.send, send));
      if (index === -1) return newId();
      const [entry] = uncertain.splice(index, 1);
      return entry.id;
    },
    /** Notes a failed send whose draft the composer shows again. */
    restored(send: unknown, id: string, error: unknown) {
      if (!thrownResultErrorHasCode(error, DELIVERY_UNKNOWN)) return;
      uncertain = [
        ...uncertain.filter((entry) => !deepEqual(entry.send, send)),
        { send: structuredClone(send), id },
      ].slice(-KEPT);
    },
  };
}
