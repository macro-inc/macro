import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import { useUserId } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { getNativeMobilePlatform } from '@core/util/platform';
import SpeakerIcon from '@icon/system/regular/speaker-high.svg';
import { Popover } from '@kobalte/core/popover';
import { Avatar, Button, Slider, Tooltip } from '@ui';
import type { RemoteParticipant } from 'livekit-client';
import { createSignal, Show } from 'solid-js';
import { LK_TRACK_SOURCE } from './livekit-loader';

/** iOS Safari exposes volume but ignores writes; native mobile owns its audio. */
export function supportsParticipantVolume() {
  if (getNativeMobilePlatform() || typeof document === 'undefined')
    return false;
  try {
    const audio = document.createElement('audio');
    audio.volume = 0.5;
    return audio.volume === 0.5;
  } catch {
    return false;
  }
}

export function CallParticipantVolume(props: {
  participant: RemoteParticipant;
  name: string;
}) {
  const supported = supportsParticipantVolume();
  const viewerId = useUserId();
  const localLabel = () => t('calls.volumeForYou', { name: props.name });
  const [volume, setVolume] = createSignal(
    Math.round(
      (props.participant.getVolume(LK_TRACK_SOURCE.Microphone) ?? 1) * 100
    )
  );
  let button: HTMLButtonElement | undefined;
  return (
    <Show when={supported && !isMobile() && !props.participant.isAgent}>
      <Popover placement="bottom-end" gutter={8}>
        <Popover.Trigger
          as={Button}
          ref={button}
          appearance="bare"
          variant="ghost"
          size="icon-sm"
          class="rounded-full bg-surface/70 text-ink"
          aria-label={t('calls.volume')}
          tooltip={t('calls.volume')}
        >
          <SpeakerIcon class="size-4" />
        </Popover.Trigger>
        <Popover.Portal
          mount={button?.closest<HTMLElement>('.portal-scope') ?? undefined}
        >
          <Popover.Content class="menu-surface z-action-menu w-64 max-w-[calc(100vw-2rem)] rounded-xl p-3 outline-none">
            <Popover.Title class="mb-3 text-sm text-ink-muted">
              {t('calls.volume')}
            </Popover.Title>
            <Slider
              value={[volume()]}
              minValue={0}
              maxValue={100}
              step={1}
              onChange={([value]) => {
                props.participant.setVolume(
                  value / 100,
                  LK_TRACK_SOURCE.Microphone
                );
                setVolume(value);
              }}
              getValueLabel={({ values }) => `${values[0]}%`}
            >
              <Slider.Label class="sr-only">{localLabel()}</Slider.Label>
              <div class="flex items-center gap-3">
                <Tooltip label={localLabel()} tabIndex={0}>
                  <Show
                    when={viewerId()}
                    fallback={
                      <Avatar size="sm">
                        <Avatar.Fallback>?</Avatar.Fallback>
                      </Avatar>
                    }
                  >
                    {(id) => (
                      <UserIcon
                        id={id()}
                        size="sm"
                        suppressClick
                        showTooltip={false}
                      />
                    )}
                  </Show>
                </Tooltip>
                <Slider.Track class="flex-1">
                  <Slider.Fill />
                  <Slider.Thumb appearance="switch">
                    <Slider.Input />
                  </Slider.Thumb>
                </Slider.Track>
                <Slider.ValueLabel class="w-10 text-right text-sm tabular-nums" />
              </div>
            </Slider>
          </Popover.Content>
        </Popover.Portal>
      </Popover>
    </Show>
  );
}
