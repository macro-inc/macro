import { useEmailView } from './email-view-context';
import { useEmailTabAvailability } from './tab-availability';
import type { EmailTab } from './types';

/**
 * Whether a tab shows in Email's navigation. Flag-gated tabs show once their
 * flags are on, or while they load with that tab already open.
 */
export function useVisibleEmailTab(): (id: EmailTab) => boolean {
  const { state } = useEmailView();
  const availability = useEmailTabAvailability();
  return (id) => {
    const tab = availability(id);
    return tab === 'on' || (tab === 'loading' && state.tab === id);
  };
}
