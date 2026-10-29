import { ViewSidebar } from '@app/components/view-shell';
import EyeIcon from '@icon/system/regular/eye.svg';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { useChannelsView } from '../channels-view-context';

function hideSupportChannelsLabel(hidden: boolean) {
  return hidden ? 'Show support channels' : 'Hide support channels';
}

export function HideSupportChannelsButton() {
  const {
    canHideSupportChannels,
    hideSupportChannels,
    setHideSupportChannels,
  } = useChannelsView();
  const label = () => hideSupportChannelsLabel(hideSupportChannels());

  return (
    <Show when={canHideSupportChannels()}>
      <ViewSidebar.Control
        aria-label={label()}
        aria-pressed={hideSupportChannels()}
        tooltip={label()}
        variant="ghost"
        size="icon-sm"
        onClick={() => setHideSupportChannels(!hideSupportChannels())}
      >
        <Show
          when={hideSupportChannels()}
          fallback={<EyeSlashIcon class="size-3.5" />}
        >
          <EyeIcon class="size-3.5" />
        </Show>
      </ViewSidebar.Control>
    </Show>
  );
}

export function HideSupportChannelsMobileButton() {
  const {
    canHideSupportChannels,
    hideSupportChannels,
    setHideSupportChannels,
  } = useChannelsView();

  return (
    <Show when={canHideSupportChannels()}>
      <div class="flex justify-end px-(--mobile-chrome-gutter) pb-2">
        <Button
          variant="secondary"
          size="sm"
          aria-pressed={hideSupportChannels()}
          onClick={() => setHideSupportChannels(!hideSupportChannels())}
        >
          {hideSupportChannelsLabel(hideSupportChannels())}
        </Button>
      </div>
    </Show>
  );
}
