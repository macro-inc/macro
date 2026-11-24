import { formatRecordingTime } from '@app/features/dictation/core/voice-memo';
import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import PauseIcon from '@icon/system/fill/pause-fill.svg?component-solid';
import PlayIcon from '@icon/system/fill/play-fill.svg?component-solid';
import SpinnerIcon from '@icon/system/regular/spinner-gap.svg?component-solid';
import { Button, cn, Slider } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';

/**
 * A voice memo as a Macro chip: play/pause, a seek track and the time, over a
 * hidden `<audio>`, so it looks the same in every engine and theme.
 */
export function VoiceMemoPlayer(props: {
  /** Unset while the memo is still uploading. */
  src?: string;
  /** Names the player for screen readers. */
  label: string;
  /** A control at the chip's end, such as remove in a draft. */
  trailing?: JSX.Element;
  class?: string;
}) {
  let audio!: HTMLAudioElement;
  const [playing, setPlaying] = createSignal(false);
  const [time, setTime] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  // A WebM memo (recorded in Firefox) reports an infinite duration until it
  // has been played through; it shows its position and seeks once known.
  // Learning it up front would download every memo in the channel.
  const readDuration = () => {
    if (Number.isFinite(audio.duration)) setDuration(audio.duration);
  };

  const toggle = async () => {
    if (!audio.paused) {
      audio.pause();
      return;
    }
    // A refused play (autoplay policy, a dead URL) never fires `pause`.
    try {
      await audio.play();
    } catch {
      setPlaying(false);
    }
  };

  // At rest the chip shows the length; once started, the position.
  const shownTime = () =>
    formatRecordingTime(1000 * (playing() || time() > 0 ? time() : duration()));
  const positionLabel = () =>
    t('channelComposer.voiceMemoPosition', {
      position: formatRecordingTime(1000 * time()),
      length: formatRecordingTime(1000 * duration()),
    });

  return (
    <div
      class={cn(
        'ph-no-capture flex h-10 w-64 max-w-full items-center gap-2 rounded-xl bg-active pl-1',
        props.trailing ? 'pr-1' : 'pr-3',
        props.class
      )}
      role="group"
      aria-label={props.label}
      data-voice-memo-player
    >
      <Show
        when={props.src}
        fallback={
          <span class="flex size-8 shrink-0 items-center justify-center text-ink-muted">
            <SpinnerIcon
              class="size-4 animate-spin"
              role="img"
              aria-label={t('channelComposer.voiceMemoUploading')}
            />
          </span>
        }
      >
        {(src) => (
          <audio
            ref={audio}
            class="hidden"
            src={src()}
            preload="metadata"
            onLoadedMetadata={readDuration}
            onDurationChange={readDuration}
            onTimeUpdate={() => setTime(audio.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setPlaying(false);
              setTime(0);
            }}
          />
        )}
      </Show>
      <Show when={props.src}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={
            playing()
              ? t('channelComposer.pauseVoiceMemo')
              : t('channelComposer.playVoiceMemo')
          }
          onClick={() => fireAndForget(toggle(), 'voice-memo-player')}
        >
          <Show
            when={playing()}
            fallback={<PlayIcon class="size-4 shrink-0 pointer-events-none" />}
          >
            <PauseIcon class="size-4 shrink-0 pointer-events-none" />
          </Show>
        </Button>
      </Show>
      <Slider
        class="min-w-0 flex-1"
        minValue={0}
        maxValue={Math.max(duration(), 0.1)}
        step={1}
        value={[Math.min(time(), duration())]}
        disabled={!props.src || duration() === 0}
        onChange={([value]) => {
          audio.currentTime = value;
          setTime(value);
        }}
      >
        <Slider.Track class="mx-1.5 my-0 h-1 w-auto">
          {/* Neutral like the rest of the chip, as the composer's Send is. */}
          <Slider.Fill class="bg-ink-muted" />
          <Slider.Thumb
            class="size-3 border-0 bg-ink shadow-none"
            aria-label={t('channelComposer.seekVoiceMemo')}
            aria-valuetext={positionLabel()}
            // Seeking keys (Home, End, arrows) stay here, not with the
            // app's list and pane shortcuts.
            data-keyboard-input
          >
            <Slider.Input aria-hidden="true" />
          </Slider.Thumb>
        </Slider.Track>
      </Slider>
      <span class="shrink-0 text-xs tabular-nums text-ink-muted">
        {shownTime()}
      </span>
      {props.trailing}
    </div>
  );
}
