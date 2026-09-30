import { defineTourTargets } from '@ui/components/Tour';

/** App chrome that tours in any view can point at. */
export const APP_TOUR = defineTourTargets('app', ['createMenu'], {
  scope: 'app',
});
