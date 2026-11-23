import { t } from '@app/lib/i18n';
import { type JSX, Show } from 'solid-js';
import type { RecordingPlayback } from '../../primitives/recording-playback';
import { createRecordingVideo } from '../../primitives/recording-video';
import { CallRecordingControls } from './CallRecordingControls';
export function CallRecordingVideo(props: {
  url: string;
  posterUrl?: string;
  playback?: RecordingPlayback;
  transcriptControls?: { visible: boolean; onToggle: () => void };
  onTimeUpdate?: (
    seconds: number,
    source: 'playback' | 'seeking' | 'seeked'
  ) => void;
  setVideoRef?: (el: HTMLVideoElement) => void;
}): JSX.Element {
  const media = createRecordingVideo(props);
  const { controls, hasVisibleVideo, playbackError, posterBlobUrl } = media;

  return (
    <div
      class="recording-video portal-scope relative flex w-full flex-col overflow-hidden rounded-2xl bg-panel"
      classList={{ 'cursor-none': !!props.playback && !controls.visible() }}
      role="group"
      aria-label={t('calls.detailPlayback')}
      tabIndex={props.playback ? 0 : undefined}
      {...media.surfaceEvents}
    >
      <video
        ref={media.setVideoRef}
        class="aspect-video w-full object-contain transition-opacity duration-200"
        classList={{
          'opacity-0': !hasVisibleVideo(),
          'opacity-100': hasVisibleVideo(),
        }}
        controls={!props.playback}
        playsinline
        preload="metadata"
        crossorigin="anonymous"
        poster={posterBlobUrl()}
        src={props.url}
        {...media.videoEvents}
      />
      <Show when={!playbackError() && props.playback}>
        {(playback) => (
          <CallRecordingControls
            playback={playback()}
            visibility={controls}
            transcript={props.transcriptControls}
          />
        )}
      </Show>
      <Show when={playbackError()}>
        <div
          role="alert"
          class="w-full max-w-lg rounded border border-alert/30 bg-alert-bg px-3 py-2 text-sm text-alert-ink"
        >
          <p class="font-medium">{t('calls.detailMediaFailed')}</p>
          <p class="mt-1 text-alert-ink/80">{t('calls.detailMediaRecovery')}</p>
          <a
            href={props.url}
            target="_blank"
            rel="noopener noreferrer"
            download=""
            class="mt-2 inline-flex font-medium text-alert-ink underline underline-offset-2 hover:text-alert-ink/80"
          >
            {t('calls.detailOpenRecording')}
          </a>
        </div>
      </Show>
    </div>
  );
}
