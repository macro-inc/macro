import { useViewControlHotkeys } from '@app/components/view-shell';
import { registerHotkey } from '@core/hotkey/hotkeys';
import type { Accessor } from 'solid-js';

/**
 * Email's search keys, registered for as long as Email is mounted.
 *
 * `/` always reaches the list header's search field: once a thread or a new
 * email has replaced that header, the key returns to the list first, as Back
 * does, and the field takes focus when it mounts.
 * Cmd+F belongs to the list header's field only; without it the key is left
 * alone, so the browser can still find text in the open thread or draft.
 */
export function useEmailSearchHotkeys(options: {
  scopeId: string;
  enabled: Accessor<boolean>;
  canSearch: Accessor<boolean>;
  /** Brings the list, and with it the header's search field, back on screen. */
  showList: () => void;
}) {
  let focusListSearch: (() => void) | undefined;
  let focusWhenListReturns = false;

  const runListSearch = () => {
    if (!focusListSearch) return false;

    focusListSearch();
    return true;
  };

  // Mail clients search with `/`; elsewhere it opens the app's search view.
  registerHotkey({
    hotkey: '/',
    scopeId: options.scopeId,
    description: 'Search email',
    condition: () => options.enabled() && options.canSearch(),
    keyDownHandler: () => {
      if (runListSearch()) return true;

      focusWhenListReturns = true;
      options.showList();
      return true;
    },
  });

  useViewControlHotkeys({
    scopeId: options.scopeId,
    enabled: options.enabled,
    search: {
      description: 'Search email',
      condition: options.canSearch,
      run: runListSearch,
    },
  });

  return {
    /** Returns the function that releases the list header's search field. */
    registerListSearch: (focus: () => void) => {
      focusListSearch = focus;

      if (focusWhenListReturns) {
        focusWhenListReturns = false;
        focus();
      }

      return () => {
        if (focusListSearch === focus) focusListSearch = undefined;
      };
    },
  };
}
