import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import MicrophoneIcon from '@icon/system/regular/microphone.svg?component-solid';
import TextAaIcon from '@icon/system/regular/text-aa.svg?component-solid';
import WaveformIcon from '@icon/system/regular/waveform.svg?component-solid';
import { Button, Dropdown } from '@ui';
import { Match, Switch } from 'solid-js';
import { DictationButton } from '../../dictation/components/dictation-controls';
import type { DictationController } from '../../dictation/core/types';
import type { VoiceMemoController } from '../../dictation/core/voice-memo';

/** Longest a tap's press may precede its click; a long press is not a tap. */
const PRESS_TO_CLICK_MS = 1000;

/**
 * The channel composer's microphone. Touch keyboards dictate on their own, so
 * on touch it records a voice memo; on desktop it asks whether to dictate into
 * the draft or record a memo, unless only one of them is offered.
 */
export function MicrophoneAction(props: {
  dictation: DictationController;
  memo: VoiceMemoController;
  showDictation: boolean;
  showMemo: boolean;
}) {
  const startMemo = () => fireAndForget(props.memo.start(), 'voice-memo');
  // A phone tap on Send hides it as the draft empties, and the tap's click
  // then lands on this button in its place: record only for a press that
  // began here moments ago, or for the keyboard (a click with no pointer,
  // `detail` 0). Touch fires pointerleave before the click, so the press is
  // matched by time rather than cleared on leave.
  let pressedAt: number | undefined;
  // Dictation is unavailable on touch devices, whose keyboards dictate.
  const canDictate = () =>
    props.showDictation && props.dictation.phase() !== 'unavailable';

  return (
    <Switch>
      <Match when={props.showMemo && !canDictate()}>
        <Button
          aria-label={t('channelComposer.recordVoiceMemo')}
          tooltip={t('channelComposer.recordVoiceMemo')}
          variant="ghost"
          size="icon-md"
          class="text-composer-ink"
          disabled={props.memo.disabled() || props.dictation.active()}
          // Keep the editor focused so the draft and caret stay put.
          onPointerDown={(event: PointerEvent) => {
            pressedAt = event.timeStamp;
          }}
          onPointerCancel={() => {
            pressedAt = undefined;
          }}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) event.preventDefault();
          }}
          onClick={(event: MouseEvent) => {
            const pressed =
              pressedAt !== undefined &&
              event.timeStamp - pressedAt < PRESS_TO_CLICK_MS;
            pressedAt = undefined;
            if (event.detail > 0 && !pressed) return;
            startMemo();
          }}
        >
          <MicrophoneIcon class="size-5 touch:size-6 shrink-0 pointer-events-none" />
        </Button>
      </Match>
      <Match when={props.showMemo && canDictate()}>
        <MicrophoneMenu
          dictation={props.dictation}
          memo={props.memo}
          onMemo={startMemo}
        />
      </Match>
      <Match when={props.showDictation}>
        <DictationButton dictation={props.dictation} />
      </Match>
    </Switch>
  );
}

function MicrophoneMenu(props: {
  dictation: DictationController;
  memo: VoiceMemoController;
  onMemo: () => void;
}) {
  // Start after the menu closes, in place of its return of focus to the
  // trigger: the recording panel takes focus itself.
  let pending: (() => void) | undefined;

  return (
    <Dropdown placement="top-end" gutter={8}>
      <Dropdown.Trigger
        tooltip={t('channelComposer.microphone')}
        aria-label={t('channelComposer.microphone')}
        variant="ghost"
        size="icon-md"
        class="text-composer-ink"
        disabled={props.memo.disabled() || props.dictation.disabled()}
      >
        <MicrophoneIcon class="size-5 shrink-0 pointer-events-none" />
      </Dropdown.Trigger>
      <Dropdown.Content
        class="min-w-40 max-w-80"
        onCloseAutoFocus={(event: Event) => {
          const run = pending;
          pending = undefined;
          if (!run) return;
          event.preventDefault();
          run();
        }}
      >
        <Dropdown.Group>
          <Dropdown.Item
            onSelect={() => {
              pending = () =>
                fireAndForget(props.dictation.start(), 'dictation');
            }}
          >
            <span class="flex size-5 shrink-0 items-center justify-center text-ink-muted">
              <TextAaIcon class="size-4" />
            </span>
            <Dropdown.ItemLabel class="min-w-0 flex-1 truncate">
              {t('channelComposer.dictate')}
            </Dropdown.ItemLabel>
          </Dropdown.Item>
          <Dropdown.Item
            onSelect={() => {
              pending = props.onMemo;
            }}
          >
            <span class="flex size-5 shrink-0 items-center justify-center text-ink-muted">
              <WaveformIcon class="size-4" />
            </span>
            <Dropdown.ItemLabel class="min-w-0 flex-1 truncate">
              {t('channelComposer.voiceMemo')}
            </Dropdown.ItemLabel>
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
