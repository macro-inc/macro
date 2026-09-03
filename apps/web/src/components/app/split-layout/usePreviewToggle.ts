import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import type { Accessor } from 'solid-js';
import { useSplitPanelOrThrow } from './layoutUtils';

export type UsePreviewToggleOptions = {
  disabled?: Accessor<boolean>;
  onEngage?: VoidFunction;
  onOpenChange?: (open: boolean) => void;
  registerHotkey?: boolean;
};

export function usePreviewToggle(options: UsePreviewToggleOptions = {}) {
  const panel = useSplitPanelOrThrow();
  const isViewer = () => panel.handle.isViewerSplit();
  const isOpen = () => panel.handle.isControllerSplit();
  const canEngage = () =>
    !(options.disabled?.() ?? false) && panel.handle.canEngagePreview();
  const canToggle = () => isOpen() || canEngage();

  const toggle = () => {
    if (isViewer()) return false;

    if (isOpen()) {
      panel.handle.disengagePreview();
      options.onOpenChange?.(false);
      return true;
    }

    if (!canEngage()) return false;

    panel.handle.engagePreview();
    if (!panel.handle.isControllerSplit()) return false;

    options.onOpenChange?.(true);
    options.onEngage?.();
    return true;
  };

  if (options.registerHotkey) {
    registerHotkey({
      hotkeyToken: TOKENS.unifiedList.togglePreview,
      scopeId: panel.splitHotkeyScope,
      description: 'Toggle preview',
      condition: () => !isViewer() && canToggle(),
      keyDownHandler: toggle,
      hotkey: 'space',
    });
  }

  return {
    canEngage,
    canToggle,
    isOpen,
    isViewer,
    toggle,
  };
}
