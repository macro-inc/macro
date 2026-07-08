import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { isSettingsPath } from '@core/constant/settingsPath';
import { isMobile } from '@core/mobile/isMobile';
import { useContext } from 'solid-js';
import {
  globalNavigate,
  globalSplitManager,
  whenSplitManagerReady,
} from '../../signal/splitLayout';
import { SplitPanelContext } from './context';
import type {
  OpenWithSplitOptions,
  ReferredFrom,
  SplitContent,
} from './layoutManager';

export function useSplitLayout() {
  const splitPanelContext = useContext(SplitPanelContext);

  function openWithSplit(
    content: SplitContent,
    options?: OpenWithSplitOptions
  ) {
    const splitManager = globalSplitManager();
    const preferNewSplit = isMobile() ? false : options?.preferNewSplit;

    if (!splitManager) {
      // Read the path from `window` rather than `useLocation()`: this function
      // is frequently invoked lazily from async event handlers (e.g. create
      // hotkeys), where the `useLocation`/`useNavigate` router primitives are
      // outside a router owner and would throw. `window.location.pathname`
      // includes the router base identically to `location.pathname`.
      if (!isSettingsPath(window.location.pathname)) {
        console.error('No split manager found');
        return;
      }

      // Settings is a full-cover route with no split layout mounted, so
      // hotkey/command-menu navigation triggered from there has nowhere to
      // open content. Leave settings for the default workspace route, then
      // finish the open once its split manager mounts.
      globalNavigate()?.(DEFAULT_ROUTE, { replace: true });
      void whenSplitManagerReady().then((manager) =>
        manager.openWithSplit(content, { ...options, preferNewSplit })
      );
      return;
    }

    return splitManager.openWithSplit(content, {
      ...options,
      preferNewSplit,
    });
  }

  function replaceOrInsertSplit(
    content: SplitContent,
    referredFrom: ReferredFrom = null
  ) {
    return openWithSplit(content, {
      referredFrom,
      handle: splitPanelContext?.handle,
      activate: true,
    });
  }

  function replaceSplit(options: {
    content: SplitContent;
    mergeHistory?: boolean;
    referredFrom?: ReferredFrom;
  }) {
    const { content, mergeHistory, referredFrom } = options;

    return openWithSplit(content, {
      mergeHistory,
      referredFrom,
      handle: splitPanelContext?.handle,
      preferNewSplit: false,
    });
  }

  function insertSplit(
    content: SplitContent,
    referredFrom: ReferredFrom = null,
    options: Pick<OpenWithSplitOptions, 'insertIndex'> = {}
  ) {
    return openWithSplit(content, {
      activate: true,
      referredFrom,
      preferNewSplit: true,
      ...options,
    });
  }

  function popoverSplit(content: SplitContent) {
    const splitManager = globalSplitManager();
    if (!splitManager) {
      console.error('no split manager found');
      return;
    }
    return splitManager.createPopoverSplit({ content: content });
  }

  function resetSplit() {
    if (!splitPanelContext) {
      console.error('No split panel context found');
      return;
    }

    splitPanelContext.handle.reset();
  }

  function getSplitCount() {
    const splitManager = globalSplitManager();
    if (!splitManager) {
      return 0;
    }
    return splitManager.getVisibleSplitCount();
  }

  return {
    openWithSplit,
    getSplitCount,
    replaceOrInsertSplit,
    replaceSplit,
    insertSplit,
    resetSplit,
    popoverSplit,
  };
}
