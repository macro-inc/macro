import { t } from '@app/lib/i18n';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import { Badge, Button, Tooltip } from '@ui';
import { Show } from 'solid-js';

export function ScreenToolbar(props: {
  title?: string;
  showStatus?: boolean;
  canControl: boolean;
  controlling: boolean;
  onToggleControl: () => void;
  onClose: () => void;
}) {
  const title = () => props.title || t('runtimeSharing.computerScreen');
  return (
    <header class="flex shrink-0 items-center gap-2 border-b border-edge-muted p-2">
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t('runtimeSharing.closeScreen')}
        tooltip={t('runtimeSharing.closeScreen')}
        onClick={props.onClose}
      >
        <ArrowLeftIcon class="size-4" />
      </Button>
      <Tooltip label={title()} class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium">{title()}</span>
      </Tooltip>
      <Show when={props.showStatus !== false}>
        <Badge size="xs" variant="secondary">
          {props.controlling
            ? t('runtimeSharing.screenInControl')
            : t('runtimeSharing.screenWatching')}
        </Badge>
      </Show>
      <Show when={props.canControl}>
        <Button size="sm" variant="secondary" onClick={props.onToggleControl}>
          {props.controlling
            ? t('runtimeSharing.screenStopControl')
            : t('runtimeSharing.screenTakeControl')}
        </Button>
      </Show>
    </header>
  );
}
