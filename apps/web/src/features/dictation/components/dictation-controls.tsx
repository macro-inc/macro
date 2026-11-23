import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import CheckIcon from '@icon/system/regular/check.svg?component-solid';
import MicrophoneIcon from '@icon/system/regular/microphone.svg?component-solid';
import TextAaIcon from '@icon/system/regular/text-aa.svg?component-solid';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import { isDictationAvailable } from '../availability';
import type { DictationController } from '../core/types';
import { formatRecordingTime } from '../core/voice-memo';
import { ComposerFeedback } from './composer-feedback';
import {
  FailureMark,
  PanelFailure,
  PrimaryAction,
  RecordingPanel,
  RetryIcon,
} from './recording-panel';
import { VolumeTimeline } from './volume-timeline';

export function DictationButton(props: {
  dictation: DictationController;
  disabled?: boolean;
}) {
  return (
    <Show when={isDictationAvailable()}>
      <Button
        aria-label={props.dictation.label()}
        variant="ghost"
        size="icon-md"
        class="text-composer-ink"
        tooltip={props.dictation.label()}
        disabled={props.disabled || props.dictation.disabled()}
        onClick={() => fireAndForget(props.dictation.start(), 'dictation')}
      >
        <MicrophoneIcon class="size-5 touch:size-6 shrink-0 pointer-events-none" />
      </Button>
    </Show>
  );
}

export function DictationPanel(props: { dictation: DictationController }) {
  const phase = () => props.dictation.phase();
  // A failed transcription keeps the recording; the action retries it.
  const failure = () =>
    phase() === 'review' && props.dictation.messageTone() === 'error'
      ? props.dictation.message()
      : '';
  const confirm = () => fireAndForget(props.dictation.confirm(), 'dictation');
  const status = () =>
    match(phase())
      .with('starting', () => t('dictation.starting'))
      .with('finishing', () => t('dictation.transcribing'))
      .with('review', () =>
        failure()
          ? undefined
          : props.dictation.limitReached()
            ? t('dictation.limitReached')
            : formatRecordingTime(props.dictation.elapsedMs())
      )
      .with('listening', 'idle', 'unavailable', () =>
        formatRecordingTime(props.dictation.elapsedMs())
      )
      .exhaustive();

  return (
    <Show when={props.dictation.active()}>
      <RecordingPanel
        label={t('dictation.panel')}
        phase={`${phase()}:${failure() ? 'failed' : ''}`}
        cancelLabel={t('dictation.cancel')}
        onCancel={props.dictation.cancel}
        mark={
          <Show
            when={failure()}
            fallback={<TextAaIcon class="size-4 text-ink-muted" />}
          >
            <FailureMark />
          </Show>
        }
        status={status()}
        onPrimary={confirm}
        primary={
          <PrimaryAction
            label={failure() ? t('dictation.retry') : t('dictation.confirm')}
            busy={phase() === 'finishing'}
            unavailable={phase() === 'starting'}
            onClick={confirm}
          >
            <Show
              when={failure()}
              fallback={
                <CheckIcon class="size-5 touch:size-6 shrink-0 pointer-events-none" />
              }
            >
              <RetryIcon />
            </Show>
          </PrimaryAction>
        }
      >
        <Show
          when={failure()}
          fallback={
            <Show when={props.dictation.volumeHistory().length > 0}>
              <VolumeTimeline levels={props.dictation.volumeHistory()} />
            </Show>
          }
        >
          {(text) => <PanelFailure text={text()} />}
        </Show>
      </RecordingPanel>
    </Show>
  );
}

/** The last attempt's note; the open panel speaks for itself. */
export function DictationFeedback(props: { dictation: DictationController }) {
  return (
    <ComposerFeedback
      text={props.dictation.active() ? '' : props.dictation.message()}
      tone={props.dictation.messageTone()}
    />
  );
}
