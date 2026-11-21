import { SplitPanelContext } from '@components/app/split-layout/context';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useContext } from 'solid-js';
import { DEFAULT_VIEW_SHELL_BREAKPOINT_THRESHOLDS } from './view-shell-layout';

/** Wide touch panes follow desktop detail routing; narrow touch keeps full-screen navigation. */
export function useInlinePreviewLayout() {
  const panel = useContext(SplitPanelContext);
  return () => {
    if (!isTouchDevice()) return true;
    if (!panel) return false;
    const width = panel.panelSize?.width;
    // Don't redirect a restored detail before the pane has been measured.
    return !width || width > DEFAULT_VIEW_SHELL_BREAKPOINT_THRESHOLDS.narrow;
  };
}
