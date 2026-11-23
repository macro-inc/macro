import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowClockwiseIcon from '@icon/system/regular/arrow-clockwise.svg?component-solid';
import StopIcon from '@icon/system/regular/stop.svg?component-solid';
import XIcon from '@icon/system/regular/x.svg?component-solid';
import { Button } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import {
  formatRecordingTime,
  type VoiceMemoController,
  type VoiceMemoNotice,
} from '../core/voice-memo';
import { VolumeTimeline } from './volume-timeline';

function noticeText(notice: VoiceMemoNotice): string {
  return match(notice)
    .with('microphone_denied', () =>
      t('channelComposer.voiceMemoMicrophoneDenied')
    )
    .with('microphone_missing', () =>
      t('channelComposer.voiceMemoMicrophoneMissing')
    )
    .with('microphone_failed', () =>
      t('channelComposer.voiceMemoMicrophoneFailed')
    )
    .with('recording_failed', () =>
      t('channelComposer.voiceMemoRecordingFailed')
    )
    .with('empty', () => t('channelComposer.voiceMemoEmpty'))
    .with('limit', () => t('channelComposer.voiceMemoLimit'))
    .with('upload_failed', () => t('channelComposer.voiceMemoUploadFailed'))
    .with('interrupted', () => t('channelComposer.voiceMemoInterrupted'))
    .exhaustive();
}

/** Covers the composer while recording; the draft underneath is untouched. */
export function VoiceMemoPanel(props: { memo: VoiceMemoController }) {
  const phase = () => props.memo.phase();
  const status = () =>
    match(phase())
      .with('starting', () => t('channelComposer.voiceMemoStarting'))
      .with('attaching', () => t('channelComposer.voiceMemoAttaching'))
      .with('failed', () => t('channelComposer.voiceMemoUploadFailed'))
      .otherwise(() => formatRecordingTime(props.memo.elapsedMs()));

  return (
    <Show when={props.memo.active()}>
      <div
        class="absolute inset-0 z-10 flex items-center gap-2 rounded-[inherit] bg-composer px-[9.375px] text-composer-ink"
        role="group"
        aria-label={t('channelComposer.voiceMemoRecording')}
        data-voice-memo-panel={phase()}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          props.memo.cancel();
        }}
      >
        <Button
          aria-label={t('channelComposer.cancelVoiceMemo')}
          tooltip={t('channelComposer.cancelVoiceMemo')}
          variant="ghost"
          size="icon-md"
          class="text-composer-ink"
          disabled={phase() === 'attaching'}
          onClick={props.memo.cancel}
        >
          <XIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
        </Button>
        <div class="flex min-w-0 flex-1 items-center gap-3 px-1">
          <span
            aria-hidden="true"
            class="size-2 shrink-0 rounded-full bg-failure"
            classList={{ 'animate-pulse': phase() === 'recording' }}
          />
          <VolumeTimeline levels={props.memo.volumeHistory()} />
          <span
            class="shrink-0 text-xs tabular-nums text-ink-muted"
            role="status"
            aria-live="polite"
          >
            {status()}
          </span>
        </div>
        <Switch>
          <Match when={phase() === 'failed'}>
            <Button
              aria-label={t('channelComposer.retryVoiceMemo')}
              tooltip={t('channelComposer.retryVoiceMemo')}
              variant="ghost"
              size="icon-md"
              class="text-composer-ink"
              ref={focusWhenConnected}
              onClick={() => fireAndForget(props.memo.retry(), 'voice-memo')}
            >
              <ArrowClockwiseIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
            </Button>
          </Match>
          <Match when={phase() !== 'failed'}>
            <Button
              aria-label={t('channelComposer.stopVoiceMemo')}
              tooltip={t('channelComposer.stopVoiceMemo')}
              variant="ghost"
              size="icon-md"
              class="text-composer-ink"
              ref={focusWhenConnected}
              // Not `disabled`: the button takes focus while the microphone
              // starts, so Space and Escape work from the first moment.
              aria-disabled={phase() !== 'recording'}
              onClick={() => fireAndForget(props.memo.stop(), 'voice-memo')}
            >
              <StopIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
            </Button>
          </Match>
        </Switch>
      </div>
    </Show>
  );
}

/** Focus the panel's primary action so Space stops and Escape discards. */
function focusWhenConnected(element: HTMLElement) {
  queueMicrotask(() => {
    if (element.isConnected) element.focus();
  });
}

export function VoiceMemoFeedback(props: { memo: VoiceMemoController }) {
  // The failed panel already says why; the line below would repeat it.
  const notice = () =>
    props.memo.phase() === 'failed' ? undefined : props.memo.notice();
  return (
    <Show when={notice()}>
      {(current) => (
        <p role="status" class="px-3 pt-1 text-xs text-ink-muted">
          {noticeText(current())}
        </p>
      )}
    </Show>
  );
}
