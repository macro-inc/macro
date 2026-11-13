import { useViewControlHotkeys } from '@app/components/view-shell';
import { registerHotkey } from '@core/hotkey/hotkeys';
import type { Accessor } from 'solid-js';

/**
 * `/` and Cmd+F reach Email's search field for as long as Email is mounted.
 * The list header's field takes them while it is on screen; a thread or a new
 * email replaces that header, and the sidebar's field takes them instead.
 */
export function useEmailSearchHotkeys(options: {
  scopeId: string;
  enabled: Accessor<boolean>;
  canSearch: Accessor<boolean>;
  /** Returns false when the sidebar's search field cannot be shown. */
  openSidebarSearch: () => boolean;
}) {
  let focusListSearch: (() => void) | undefined;

  const runSearch = () => {
    if (!focusListSearch) return options.openSidebarSearch();

    focusListSearch();
    return true;
  };

  // Mail clients search with `/`; elsewhere it opens the app's search view.
  registerHotkey({
    hotkey: '/',
    scopeId: options.scopeId,
    description: 'Search email',
    condition: () => options.enabled() && options.canSearch(),
    keyDownHandler: runSearch,
  });

  useViewControlHotkeys({
    scopeId: options.scopeId,
    enabled: options.enabled,
    search: {
      description: 'Search email',
      condition: options.canSearch,
      run: runSearch,
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
