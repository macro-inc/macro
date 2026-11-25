import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import StopFillIcon from '@icon/system/fill/stop-fill.svg?component-solid';
import { Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import type { DictationMessageTone } from '../core/types';
import {
  formatRecordingTime,
  type VoiceMemoController,
  type VoiceMemoNotice,
} from '../core/voice-memo';
import { ComposerFeedback } from './composer-feedback';
import {
  FailureMark,
  PanelFailure,
  PrimaryAction,
  RecordingPanel,
  RetryIcon,
} from './recording-panel';
import { VolumeTimeline } from './volume-timeline';

export function voiceMemoNoticeText(notice: VoiceMemoNotice): string {
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

export function voiceMemoNoticeTone(
  notice: VoiceMemoNotice
): DictationMessageTone {
  return match(notice)
    .with('limit', 'interrupted', () => 'info' as const)
    .with(
      'microphone_denied',
      'microphone_missing',
      'microphone_failed',
      'recording_failed',
      'empty',
      'upload_failed',
      () => 'error' as const
    )
    .exhaustive();
}

/** Covers the composer while recording; the draft underneath is untouched. */
export function VoiceMemoPanel(props: { memo: VoiceMemoController }) {
  const phase = () => props.memo.phase();
  const primary = () =>
    phase() === 'failed'
      ? fireAndForget(props.memo.retry(), 'voice-memo')
      : fireAndForget(props.memo.stop(), 'voice-memo');
  const status = () =>
    match(phase())
      .with('starting', () => t('channelComposer.voiceMemoStarting'))
      .with('attaching', () => t('channelComposer.voiceMemoAttaching'))
      .with('idle', 'recording', 'failed', 'unavailable', () => undefined)
      .exhaustive();
  const time = () =>
    phase() === 'recording'
      ? formatRecordingTime(props.memo.elapsedMs())
      : undefined;

  return (
    <Show when={props.memo.active()}>
      <RecordingPanel
        label={t('channelComposer.voiceMemoRecording')}
        phase={phase()}
        data-voice-memo-panel={phase()}
        cancelLabel={t('channelComposer.cancelVoiceMemo')}
        // An upload in flight finishes into the draft.
        cancelDisabled={phase() === 'attaching'}
        onCancel={props.memo.cancel}
        mark={
          <Switch>
            <Match when={phase() === 'failed'}>
              <FailureMark />
            </Match>
            <Match when={phase() === 'recording'}>
              <span
                class="size-2 rounded-full bg-failure"
                classList={{
                  'animate-pulse motion-reduce:animate-none':
                    phase() === 'recording',
                }}
              />
            </Match>
          </Switch>
        }
        status={status()}
        failure={
          phase() === 'failed'
            ? t('channelComposer.voiceMemoUploadFailed')
            : undefined
        }
        time={time()}
        onPrimary={primary}
        primaryInert={phase() === 'starting' || phase() === 'attaching'}
        primary={
          <PrimaryAction
            label={
              phase() === 'failed'
                ? t('channelComposer.retryVoiceMemo')
                : t('channelComposer.stopVoiceMemo')
            }
            busy={phase() === 'attaching'}
            unavailable={phase() === 'starting'}
            onClick={primary}
          >
            <Show
              when={phase() === 'failed'}
              fallback={
                <StopFillIcon class="size-4 touch:size-5 shrink-0 pointer-events-none" />
              }
            >
              <RetryIcon />
            </Show>
          </PrimaryAction>
        }
      >
        <Switch>
          <Match when={phase() === 'failed'}>
            <PanelFailure text={t('channelComposer.voiceMemoUploadFailed')} />
          </Match>
          <Match
            when={
              // Attaching keeps the recording's timeline, still.
              (phase() === 'recording' || phase() === 'attaching') &&
              props.memo.volumeHistory().length > 0
            }
          >
            <VolumeTimeline levels={props.memo.volumeHistory()} />
          </Match>
        </Switch>
      </RecordingPanel>
    </Show>
  );
}

export function VoiceMemoFeedback(props: { memo: VoiceMemoController }) {
  // The open panel already says why.
  const notice = () => (props.memo.active() ? undefined : props.memo.notice());
  return (
    <Show when={notice()}>
      {(current) => (
        <ComposerFeedback
          text={voiceMemoNoticeText(current())}
          tone={voiceMemoNoticeTone(current())}
        />
      )}
    </Show>
  );
}
