import { deepEqual } from '@core/util/compareUtils';
import { thrownResultErrorHasCode } from '@core/util/result';

/** The code a send fails with when the server could not say whether it has it. */
const DELIVERY_UNKNOWN = 'DELIVERY_UNKNOWN';

/**
 * Remembers the last send whose delivery could not be confirmed, so sending
 * the same message again reuses its id: the server answers a send it already
 * has without writing it twice, while a fresh id would post it again.
 */
export function createUncertainSends(newId: () => string) {
  let uncertain: { send: unknown; id: string } | undefined;
  return {
    /** The id to send `send` (where it goes and what it says) under. */
    idFor(send: unknown): string {
      const last = uncertain;
      uncertain = undefined;
      if (last && deepEqual(last.send, send)) return last.id;
      return newId();
    },
    /** Notes a failed send, kept only when its delivery is unknown. */
    failed(send: unknown, id: string, error: unknown) {
      if (thrownResultErrorHasCode(error, DELIVERY_UNKNOWN)) {
        uncertain = { send: structuredClone(send), id };
      }
    },
  };
}
