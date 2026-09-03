import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { TOKENS } from '@core/hotkey/tokens';
import EyeIcon from '@phosphor-icons/core/regular/eye.svg?component-solid';
import EyeSlashIcon from '@phosphor-icons/core/regular/eye-slash.svg?component-solid';
import { Button, cn, Tooltip } from '@ui';
import { Show } from 'solid-js';
import { usePreviewToggle } from '../usePreviewToggle';

/** Toggle Preview mode for eligible Controller content outside a Viewer. */
export function PreviewButton(
  props: {
    disabled?: boolean;
    disabledLabel?: string;
    onEngage?: () => void;
    onOpenChange?: (open: boolean) => void;
    hideLabel?: boolean;
    iconOnly?: boolean;
    class?: string;
    registerHotkey?: boolean;
  } = {}
) {
  const analytics = useAnalytics();

  const preview = usePreviewToggle({
    disabled: () => props.disabled ?? false,
    onEngage: () => {
      analytics.track('preview_panel_use');
      props.onEngage?.();
    },
    onOpenChange: props.onOpenChange,
    registerHotkey: props.registerHotkey ?? true,
  });

  const unavailableLabel = () =>
    props.disabled
      ? (props.disabledLabel ?? 'Preview unavailable')
      : 'No space for preview';

  return (
    <Show when={!preview.isViewer()}>
      <Tooltip
        hotkey={
          preview.canToggle() ? TOKENS.unifiedList.togglePreview : undefined
        }
        label={preview.canToggle() ? 'Preview' : unavailableLabel()}
      >
        <Button
          onClick={preview.toggle}
          variant="outline"
          size={props.iconOnly ? 'md' : 'sm'}
          square={props.iconOnly}
          depth={2}
          class={cn('bg-surface', props.class)}
          disabled={!preview.canToggle()}
          aria-label={props.hideLabel || props.iconOnly ? 'Preview' : undefined}
        >
          {preview.isOpen() ? <EyeSlashIcon /> : <EyeIcon />}
          <Show when={!props.hideLabel && !props.iconOnly}>
            <span>Preview</span>
          </Show>
        </Button>
      </Tooltip>
    </Show>
  );
}
