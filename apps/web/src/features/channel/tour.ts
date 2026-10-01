import { defineTourTargets } from '@ui/components/Tour';

/** Parts of an open conversation that tours can point at. */
export const CHANNEL_TOUR = defineTourTargets('channel', [
  'messages',
  'composer',
  'call',
]);
