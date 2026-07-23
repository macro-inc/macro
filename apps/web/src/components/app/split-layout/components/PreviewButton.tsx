import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import EyeIcon from '@phosphor-icons/core/regular/eye.svg?component-solid';
import EyeSlashIcon from '@phosphor-icons/core/regular/eye-slash.svg?component-solid';
import { Button, Tooltip } from '@ui';
import { Show } from 'solid-js';
import { useSplitPanelOrThrow } from '../layoutUtils';

/** Toggle Preview mode for eligible Controller content outside a Viewer. */
export function PreviewButton() {
  const panel = useSplitPanelOrThrow();
  const analytics = useAnalytics();

  const isViewer = () => panel.handle.isPreviewSplit();
  const previewEngaged = () => panel.handle.isPreviewEngaged();
  const canEngage = () => panel.handle.canEngagePreview();

  const togglePreview = () => {
    if (previewEngaged()) {
      panel.handle.disengagePreview();
      return;
    }
    if (!canEngage()) return;

    analytics.track('preview_panel_use');
    panel.handle.engagePreview();
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
        label={canEngage() ? 'Preview' : 'No space for preview'}
      >
        <Button
          onClick={togglePreview}
          variant="base"
          size="sm"
          depth={2}
          class="bg-surface"
          disabled={!canEngage()}
        >
          {previewEngaged() ? <EyeSlashIcon /> : <EyeIcon />}
          <span>Preview</span>
        </Button>
      </Tooltip>
    </Show>
  );
}
