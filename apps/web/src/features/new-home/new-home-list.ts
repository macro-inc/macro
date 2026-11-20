import { asideWidthPreferenceKey } from '@app/components/view-shell';
import { usePreference } from '@app/lib/preferences/use-preference';
import type { HomeListWidth } from '../home/components/HomeViewLayout';

/**
 * One list width for both of New Home's tabs, so switching tabs never moves
 * the list. It starts at Home's width and can widen to the Notifications
 * view's wider bound, for rows that read as sentences.
 */
export const NEW_HOME_LIST: HomeListWidth = {
  asidePreferenceKey: 'new-home',
  aside: { max: 480, preserveDuringResize: false },
};

/**
 * Start New Home's list at the width the viewer gave old Home, once, before
 * the list's shell reads it.
 */
export function seedNewHomeListWidth() {
  const [homeWidth] = usePreference<number | undefined>(
    asideWidthPreferenceKey('home'),
    { default: undefined }
  );
  const [newHomeWidth, setNewHomeWidth] = usePreference<number | undefined>(
    asideWidthPreferenceKey(NEW_HOME_LIST.asidePreferenceKey),
    { default: undefined }
  );
  const seed = homeWidth();
  if (newHomeWidth() === undefined && seed !== undefined) setNewHomeWidth(seed);
}
