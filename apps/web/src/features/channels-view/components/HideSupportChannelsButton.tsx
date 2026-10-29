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
      <Button
        variant="secondary"
        size="sm"
        aria-pressed={hideSupportChannels()}
        class="w-full"
        onClick={() => setHideSupportChannels(!hideSupportChannels())}
      >
        {label()}
      </Button>
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
