import type { SplitRouteClaim } from './types';
import { throwIfAborted } from './utils';

export type ClaimReservation = {
  move(claim: SplitRouteClaim | undefined): void;
  wait(signal: AbortSignal): void | Promise<void>;
  release(): void;
};

/** Pending ownership only. Accepted ownership is read from the host layout. */
export function createClaimReservations() {
  type Slot = { key?: string; released: boolean };
  const queues = new Map<string, Set<Slot>>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const remove = (slot: Slot) => {
    if (slot.key === undefined) return;
    const queue = queues.get(slot.key);
    queue?.delete(slot);
    if (queue?.size === 0) queues.delete(slot.key);
    slot.key = undefined;
  };

  return {
    reserve(claim: SplitRouteClaim | undefined): ClaimReservation {
      const slot: Slot = { released: false };
      const ownsTurn = () =>
        slot.key === undefined ||
        queues.get(slot.key)?.values().next().value === slot;
      const reservation: ClaimReservation = {
        move(next) {
          if (slot.released) return;
          const key = next
            ? JSON.stringify([next.namespace, next.id])
            : undefined;
          if (key === slot.key) return;
          remove(slot);
          if (key !== undefined) {
            const queue = queues.get(key) ?? new Set<Slot>();
            queue.add(slot);
            queues.set(key, queue);
            slot.key = key;
          }
          notify();
        },
        wait(signal) {
          throwIfAborted(signal);
          if (ownsTurn()) return;
          return new Promise<void>((resolve, reject) => {
            const cleanup = () => {
              listeners.delete(check);
              signal.removeEventListener('abort', abort);
            };
            const abort = () => {
              cleanup();
              reject(
                signal.reason ?? new DOMException('Aborted', 'AbortError')
              );
            };
            const check = () => {
              if (signal.aborted) return abort();
              if (!ownsTurn()) return;
              cleanup();
              resolve();
            };
            listeners.add(check);
            signal.addEventListener('abort', abort, { once: true });
            check();
          });
        },
        release() {
          if (slot.released) return;
          slot.released = true;
          remove(slot);
          notify();
        },
      };
      reservation.move(claim);
      return reservation;
    },
  };
}
