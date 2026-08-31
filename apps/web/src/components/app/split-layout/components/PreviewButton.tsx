import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import EyeIcon from '@phosphor-icons/core/regular/eye.svg?component-solid';
import EyeSlashIcon from '@phosphor-icons/core/regular/eye-slash.svg?component-solid';
import { Button, Tooltip } from '@ui';
import { Show } from 'solid-js';
import { useSplitPanelOrThrow } from '../layoutUtils';

/** Toggle Preview mode for eligible Controller content outside a Viewer. */
export function PreviewButton(
  props: {
    disabled?: boolean;
    disabledLabel?: string;
    onEngage?: () => void;
    onOpenChange?: (open: boolean) => void;
    hideLabel?: boolean;
  } = {}
) {
  const panel = useSplitPanelOrThrow();
  const analytics = useAnalytics();

  const isViewer = () => panel.handle.isViewerSplit();
  const isController = () => panel.handle.isControllerSplit();
  const canEngage = () => !props.disabled && panel.handle.canEngagePreview();
  const unavailableLabel = () =>
    props.disabled
      ? (props.disabledLabel ?? 'Preview unavailable')
      : 'No space for preview';

  const togglePreview = () => {
    if (isController()) {
      panel.handle.disengagePreview();
      props.onOpenChange?.(false);
      return;
    }
    if (!canEngage()) return;

    analytics.track('preview_panel_use');
    panel.handle.engagePreview();
    if (panel.handle.isControllerSplit()) {
      props.onOpenChange?.(true);
      props.onEngage?.();
    }
  };

  registerHotkey({
    hotkeyToken: TOKENS.unifiedList.togglePreview,
    scopeId: panel.splitHotkeyScope,
    description: 'Toggle preview',
    condition: () => !isViewer() && canEngage(),
    keyDownHandler: () => {
      togglePreview();
      return true;
    },
    hotkey: 'space',
  });

  return (
    <Show when={!isViewer()}>
      <Tooltip
        hotkey={canEngage() ? TOKENS.unifiedList.togglePreview : undefined}
        label={canEngage() ? 'Preview' : unavailableLabel()}
      >
        <Button
          onClick={togglePreview}
          variant="outline"
          size="sm"
          depth={2}
          class="bg-surface"
          disabled={!canEngage()}
          aria-label={props.hideLabel ? 'Preview' : undefined}
        >
          {isController() ? <EyeSlashIcon /> : <EyeIcon />}
          <Show when={!props.hideLabel}>
            <span>Preview</span>
          </Show>
        </Button>
      </Tooltip>
    </Show>
  );
}
