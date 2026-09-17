import CheckIcon from '@phosphor-icons/core/regular/check.svg?component-solid';
import MicrophoneIcon from '@phosphor-icons/core/regular/microphone.svg?component-solid';
import XIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { DictationController } from '../core/types';
import { VolumeTimeline } from './volume-timeline';

export function DictationButton(props: {
  dictation: DictationController;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-composer"
      class="rounded-full text-ink not-touch:text-composer-ink"
      label={props.dictation.label()}
      tooltip={props.dictation.label()}
      disabled={props.disabled || props.dictation.disabled()}
      onClick={() => void props.dictation.start()}
    >
      <MicrophoneIcon />
    </Button>
  );
}

export function DictationPanel(props: { dictation: DictationController }) {
  return (
    <Show when={props.dictation.active()}>
      <div
        class="absolute inset-0 z-10 flex items-center gap-2 rounded-[inherit] bg-composer px-[9.375px] text-composer-ink touch:bg-chrome"
        role="group"
        aria-label="Dictation"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            props.dictation.cancel();
          }
        }}
      >
        <div class="flex min-w-0 flex-1 items-center gap-3 px-2">
          <VolumeTimeline levels={props.dictation.volumeHistory()} />
          <span
            class="shrink-0 text-xs text-ink-muted"
            classList={{ 'sr-only': props.dictation.phase() === 'listening' }}
            role="status"
          >
            {match(props.dictation.phase())
              .with('starting', () => 'Starting…')
              .with('finishing', () => 'Finishing…')
              .with('review', () => 'Ready')
              .otherwise(() => 'Listening…')}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-composer"
          class="rounded-full text-composer-ink"
          label="Cancel dictation"
          ref={(element) =>
            queueMicrotask(() => {
              if (element.isConnected) element.focus();
            })
          }
          onClick={props.dictation.cancel}
        >
          <XIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-composer"
          class="rounded-full text-composer-ink"
          label="Use dictation"
          disabled={props.dictation.phase() === 'starting'}
          onClick={() => void props.dictation.confirm()}
        >
          <CheckIcon />
        </Button>
      </div>
    </Show>
  );
}

export function DictationFeedback(props: { dictation: DictationController }) {
  const message = () =>
    props.dictation.phase() === 'installing'
      ? 'Downloading speech language for on-device dictation…'
      : props.dictation.message();
  return (
    <Show when={message()}>
      <p role="status" class="px-3 pt-1 text-xs text-ink-muted">
        {message()}
      </p>
    </Show>
  );
}
