import { defineTourTargets } from '@ui';

/** Parts of an open conversation that tours can point at. */
export const CHANNEL_TOUR = defineTourTargets('channel', [
  'messages',
  'composer',
  'call',
]);
