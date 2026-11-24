import { deepEqual } from '@core/util/compareUtils';
import { thrownResultErrorHasCode } from '@core/util/result';

/** The code a send fails with when the server could not say whether it has it. */
const DELIVERY_UNKNOWN = 'DELIVERY_UNKNOWN';

/** How many restored drafts of unknown delivery keep their ids. */
const KEPT = 20;

/** Who sends a message and where it goes, plus what it says. */
type UncertainSend = Readonly<Record<string, unknown>> & { message: unknown };

const samePlace = (a: UncertainSend, b: UncertainSend) =>
  deepEqual({ ...a, message: undefined }, { ...b, message: undefined });

/**
 * Remembers sends whose delivery could not be confirmed and whose draft came
 * back to the composer, so sending that draft again reuses its id: the server
 * answers a send it already has without writing it twice, while a fresh id
 * would post it again. A send is keyed by who sends it, where it goes and
 * what it says. Only the restored draft keeps the id: once the composer holds
 * something else for that place, the same words sent later are a new message.
 */
export function createUncertainSends(newId: () => string) {
  let uncertain: { send: UncertainSend; id: string }[] = [];
  return {
    /** The id to send `send` under. */
    idFor(send: UncertainSend): string {
      const index = uncertain.findIndex((entry) => deepEqual(entry.send, send));
      if (index === -1) return newId();
      const [entry] = uncertain.splice(index, 1);
      return entry.id;
    },
    /** Notes a failed send whose draft the composer shows again. */
    restored(send: UncertainSend, id: string, error: unknown) {
      if (!thrownResultErrorHasCode(error, DELIVERY_UNKNOWN)) return;
      uncertain = [
        ...uncertain.filter((entry) => !deepEqual(entry.send, send)),
        { send: structuredClone(send), id },
      ].slice(-KEPT);
    },
    /**
     * Notes what a composer now holds for a place; call it with drafts that
     * have something to send. A restored draft edited, or replaced, gives up
     * its id. An empty composer is not a change: sending clears the composer
     * before the send asks for its id.
     */
    drafted(send: UncertainSend) {
      uncertain = uncertain.filter(
        (entry) => !samePlace(entry.send, send) || deepEqual(entry.send, send)
      );
    },
  };
}
