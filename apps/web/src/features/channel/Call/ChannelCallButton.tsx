import { t } from '@app/lib/i18n';
import { HeaderActionButton } from '@components/app/HeaderActionButton';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import PhoneIcon from '@icon/system/regular/phone.svg';
import { Button } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { Show } from 'solid-js';
import { CHANNEL_TOUR } from '../tour';
import { useStartChannelCall } from './use-start-channel-call';

export function ChannelCallButton(props: {
  channelId: string;
  grouped?: boolean;
}) {
  const call = useStartChannelCall(() => props.channelId);
  const start = () => fireAndForget(call.start(), 'channel-call');
  return (
    <Show when={!call.isInThisChannel()}>
      <Show
        when={call.isCallInProgress()}
        fallback={
          <HeaderActionButton
            grouped={props.grouped}
            ref={tourTarget(CHANNEL_TOUR.call)}
            onClick={start}
            tooltip="Start Call"
            label="Call"
            icon={
              <PhoneIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
            }
          />
        }
      >
        <Button
          ref={tourTarget(CHANNEL_TOUR.call)}
          variant="success"
          size={isMobile() ? 'icon-lg' : 'sm'}
          aria-label={t('calls.join')}
          tooltip={t('calls.join')}
          disabled={call.isJoining()}
          onClick={start}
        >
          <PhoneIcon class="size-4 touch:size-6" />
          <Show when={!isMobile()}>{t('calls.join')}</Show>
        </Button>
      </Show>
    </Show>
  );
}
