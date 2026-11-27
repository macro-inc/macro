import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isMobile } from '@core/mobile/isMobile';
import { getNativeMobilePlatform } from '@core/util/platform';
import SpeakerIcon from '@icon/system/regular/speaker-high.svg';
import SpeakerSlash from '@icon/system/regular/speaker-slash.svg';
import { Popover } from '@kobalte/core/popover';
import { Button, type ButtonProps, Slider } from '@ui';
import type { RemoteParticipant } from 'livekit-client';
import { createSignal, Show } from 'solid-js';
import {
  createCallVolumeState,
  useCallVolumeOptional,
} from '../context/call-volume';

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
  const localLabel = () => t('calls.volumeForYou', { name: props.name });
  const volumes = useCallVolumeOptional() ?? createCallVolumeState();
  const volume = () => Math.round(volumes.level(props.participant) * 100);
  const setLevel = (value: number) =>
    volumes.set(props.participant, Math.max(0, Math.min(100, value)) / 100);
  const [open, setOpen] = createSignal(false);
  let button: HTMLButtonElement | undefined;
  const VolumeButton = (buttonProps: ButtonProps) => (
    <Button
      appearance="bare"
      variant="ghost"
      size="icon-sm"
      class="rounded-full bg-surface/70 text-ink"
      aria-label={t('calls.volume')}
      tooltip={volume() === 0 ? t('calls.mutedForYou') : t('calls.volume')}
      {...buttonProps}
    >
      <Show when={volume() === 0} fallback={<SpeakerIcon class="size-4" />}>
        <SpeakerSlash class="size-4" />
      </Show>
    </Button>
  );
  const VolumeSlider = () => (
    <Slider
      orientation={isMobile() ? 'horizontal' : 'vertical'}
      class={isMobile() ? 'w-full' : 'items-center'}
      onWheel={(event: WheelEvent) => {
        if (!event.deltaY) return;
        event.preventDefault();
        event.stopPropagation();
        setLevel(volume() - Math.sign(event.deltaY));
      }}
      value={[volume()]}
      minValue={0}
      maxValue={100}
      step={1}
      onChange={([value]) => setLevel(value)}
      getValueLabel={({ values }) => `${values[0]}%`}
    >
      <Slider.Label class="sr-only">{localLabel()}</Slider.Label>
      <div class="flex flex-col items-center gap-3">
        <div class={isMobile() ? 'w-full py-3' : 'h-32'}>
          <Slider.Track data-call-volume-track>
            <Slider.Fill />
            <Slider.Thumb appearance="switch">
              <Slider.Input />
            </Slider.Thumb>
          </Slider.Track>
        </div>
        <Slider.ValueLabel class="text-center text-xs tabular-nums" />
      </div>
    </Slider>
  );
  return (
    <Show when={supported && !props.participant.isAgent}>
      <Show
        when={isMobile()}
        fallback={
          <Popover placement="bottom-end" gutter={8}>
            <Popover.Trigger as={VolumeButton} ref={button} />
            <Popover.Portal
              mount={button?.closest<HTMLElement>('.portal-scope') ?? undefined}
            >
              <Popover.Content class="menu-surface z-action-menu w-14 rounded-xl p-3 outline-none">
                <Popover.Title class="sr-only">{localLabel()}</Popover.Title>
                <VolumeSlider />
              </Popover.Content>
            </Popover.Portal>
          </Popover>
        }
      >
        <MobileDrawer open={open()} onOpenChange={setOpen} restoreFocus>
          <VolumeButton
            aria-haspopup="dialog"
            aria-expanded={open()}
            onClick={() => setOpen(true)}
          />
          <MobileDrawer.Portal>
            <MobileDrawer.Overlay />
            <MobileDrawer.Content>
              <MobileDrawer.Handle />
              <MobileDrawer.Title class="px-6 pb-3 text-sm font-medium">
                {localLabel()}
              </MobileDrawer.Title>
              <MobileDrawer.ScrollBody>
                <div class="px-6 pb-6">
                  <VolumeSlider />
                </div>
              </MobileDrawer.ScrollBody>
            </MobileDrawer.Content>
          </MobileDrawer.Portal>
        </MobileDrawer>
      </Show>
    </Show>
  );
}
