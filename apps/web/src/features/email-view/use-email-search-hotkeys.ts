import { useViewControlHotkeys } from '@app/components/view-shell';
import type { Accessor } from 'solid-js';

/**
 * Email's search key, registered for as long as Email is mounted.
 *
 * Cmd+F belongs to the list header's field only; without it the key is left
 * alone, so the browser can still find text in the open thread or draft.
 */
export function useEmailSearchHotkeys(options: {
  scopeId: string;
  enabled: Accessor<boolean>;
  canSearch: Accessor<boolean>;
}) {
  let focusListSearch: (() => void) | undefined;

  useViewControlHotkeys({
    scopeId: options.scopeId,
    enabled: options.enabled,
    search: {
      description: 'Search email',
      condition: options.canSearch,
      run: () => {
        if (!focusListSearch) return false;

        focusListSearch();
        return true;
      },
    },
  });

  return {
    /** Returns the function that releases the list header's search field. */
    registerListSearch: (focus: () => void) => {
      focusListSearch = focus;

      return () => {
        if (focusListSearch === focus) focusListSearch = undefined;
      };
    },
  };
}
