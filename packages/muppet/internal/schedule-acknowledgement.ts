import { trackMaintenanceTask } from '../core/maintenance.ts';

const acknowledgements = new WeakMap<object, Promise<void>>();

/** Associates a replayable payload with its durable acknowledgement. */
export const acknowledgeMaintenanceEvent = (payload: object): (() => void) => {
  const acknowledgement = Promise.withResolvers<void>();
  acknowledgements.set(payload, acknowledgement.promise);
  return () => {
    acknowledgements.delete(payload);
    acknowledgement.resolve();
  };
};

/** Keep an admitted event active until the source records its completion. */
export const trackMaintenanceAcknowledgement = (payload: unknown): void => {
  if (typeof payload !== 'object' || payload === null) return;
  const acknowledged = acknowledgements.get(payload);
  if (acknowledged !== undefined) void trackMaintenanceTask(() => acknowledged);
};
