import { createCrossTabBus } from '@core/cross-tab/cross-tab-bus';
import { match, P } from 'ts-pattern';

type LicenseUpdateMessage = {
  type: 'license-updated';
  /**
   * Publish time. Makes each payload unique so the bus's storage fallback
   * fires (see `cross-tab-bus.ts`).
   */
  sentAt: number;
};

const licenseBus = createCrossTabBus<LicenseUpdateMessage>({
  channelName: 'license-update',
  storageKey: 'macro.license-update',
  parse: (value) =>
    match(value)
      .with(
        { type: 'license-updated', sentAt: P.number },
        ({ type, sentAt }) => ({ type, sentAt })
      )
      .otherwise(() => null),
});

/**
 * utility interface for sending license update events across browser tabs without need to ipc (more direct)
 */
export const licenseChannel = {
  subscribe: (handler: () => void) => licenseBus.subscribe(handler),
  post: () => {
    licenseBus.publish({ type: 'license-updated', sentAt: Date.now() });
  },
};
