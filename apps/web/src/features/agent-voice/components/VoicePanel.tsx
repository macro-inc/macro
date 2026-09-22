import Microphone from '@phosphor-icons/core/regular/microphone.svg?component-solid';
import MicrophoneSlash from '@phosphor-icons/core/regular/microphone-slash.svg?component-solid';
import Waveform from '@phosphor-icons/core/regular/waveform.svg?component-solid';
import X from '@phosphor-icons/core/regular/x.svg?component-solid';
import { Button, Dialog } from '@ui';
import { For, Show } from 'solid-js';
import type { VoiceState } from '../core/types';
import { VoiceWaveform } from './VoiceWaveform';

export function VoicePanel(props: {
  open: boolean;
  state: VoiceState;
  onClose: () => void;
  onStart: () => void;
  onEnd: () => void;
  onMute: () => void;
  onVoice: (voice: string) => void;
  onEnablePlayback: () => void;
}) {
  const connected = () => props.state.phase === 'connected';
  const active = () =>
    connected() ||
    props.state.phase === 'connecting' ||
    props.state.phase === 'reconnecting';
  const status = () => {
    if (props.state.phase === 'loading') return 'Getting ready';
    if (props.state.phase === 'connecting') return 'Connecting';
    if (props.state.phase === 'reconnecting') return 'Reconnecting';
    if (props.state.phase === 'ending') return 'Ending conversation';
    if (props.state.phase === 'error') return 'Let’s reconnect';
    if (!connected()) return 'A little more human';
    if (props.state.reviewRequired) return 'Your review is needed';
    if (props.state.agentState === 'speaking') return 'Macro is speaking';
    if (props.state.muted) return 'Microphone is muted';
    if (props.state.agentState === 'thinking') return 'Thinking with you';
    return 'I’m listening';
  };
  const latest = () => props.state.captions.slice(-3);
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      position="center"
      class="w-[440px]! overflow-hidden rounded-3xl! border border-edge-muted"
      animate
    >
      <div class="relative flex max-h-[85dvh] flex-col overflow-y-auto bg-surface px-6 pb-6 pt-5 text-ink sm:px-8">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 text-xs font-medium text-ink-muted">
            <Waveform class="size-4 text-accent" /> MACRO VOICE
          </div>
          <Button
            size="icon-sm"
            label={active() ? 'Minimize voice' : 'Close voice'}
            onClick={props.onClose}
          >
            <X />
          </Button>
        </div>
        <div class="pt-7 text-center">
          <Dialog.Title class="text-2xl font-medium tracking-tight">
            {status()}
          </Dialog.Title>
          <Dialog.Description class="mt-2 text-sm text-ink-muted">
            {connected()
              ? 'Speak naturally. You can interrupt anytime.'
              : 'Talk through ideas and get things done, together.'}
          </Dialog.Description>
        </div>
        <VoiceWaveform
          input={props.state.inputLevel}
          output={props.state.outputLevel}
          muted={props.state.muted}
          connected={connected()}
        />
        <div class="-mt-2 truncate text-center text-xs text-ink-muted">
          {props.state.target?.title ?? 'Your Macro agent'}
        </div>
        <Show when={props.state.error}>
          <p
            role="alert"
            class="mt-5 rounded-xl border border-failure/20 bg-failure-bg px-4 py-3 text-sm text-failure"
          >
            {props.state.error}
          </p>
        </Show>
        <Show when={props.state.playbackBlocked}>
          <Button
            class="mt-4"
            variant="accent"
            onClick={props.onEnablePlayback}
          >
            Enable audio playback
          </Button>
        </Show>
        <Show when={props.state.reviewRequired}>
          <p
            role="status"
            class="mt-4 rounded-xl bg-accent-bg p-3 text-sm text-accent"
          >
            Open your conversation to review and answer. Voice will stay
            connected.
          </p>
        </Show>
        <Show when={latest().length > 0}>
          <div
            class="mt-5 max-h-36 overflow-y-auto space-y-3 rounded-2xl border border-edge-muted bg-surface-2/40 px-4 py-3"
            aria-label="Live captions"
            aria-live="polite"
            aria-relevant="text additions"
          >
            <For each={latest()}>
              {(caption) => (
                <div>
                  <span class="text-[10px] font-medium uppercase tracking-wider text-ink-muted">
                    {caption.speaker === 'user' ? 'You' : 'Macro'}
                  </span>
                  <p
                    class="mt-0.5 text-sm leading-relaxed"
                    classList={{ 'text-ink-muted': !caption.final }}
                  >
                    {caption.text}
                  </p>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={!active()}>
          <Show when={props.state.options?.voices.length}>
            <fieldset
              class="mt-6"
              disabled={
                props.state.phase === 'loading' ||
                props.state.phase === 'ending'
              }
            >
              <legend class="mb-2.5 text-xs font-medium text-ink-muted">
                CHOOSE A VOICE
              </legend>
              <div class="grid grid-cols-3 gap-2">
                <For each={props.state.options?.voices ?? []}>
                  {(voice) => (
                    <button
                      type="button"
                      aria-pressed={props.state.voice === voice.id}
                      onClick={() => props.onVoice(voice.id)}
                      class="rounded-xl border px-3 py-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none"
                      classList={{
                        'border-accent/50 bg-accent-bg text-accent':
                          props.state.voice === voice.id,
                        'border-edge-muted bg-surface-2/30 text-ink-muted hover:bg-hover':
                          props.state.voice !== voice.id,
                      }}
                    >
                      {voice.label}
                    </button>
                  )}
                </For>
              </div>
            </fieldset>
          </Show>
          <Show when={props.state.options && !props.state.options.enabled}>
            <p class="mt-4 text-sm text-ink-muted">
              Voice isn’t available for this agent yet. You can keep chatting
              with text.
            </p>
          </Show>
        </Show>
        <div class="mt-6 flex items-center justify-center gap-3">
          <Show
            when={active()}
            fallback={
              <Button
                variant="strong"
                size="xl"
                class="w-full rounded-2xl"
                disabled={
                  props.state.phase === 'loading' ||
                  (props.state.options !== undefined &&
                    !props.state.options.enabled) ||
                  props.state.phase === 'ending'
                }
                onClick={props.onStart}
              >
                <Waveform class="size-5" />
                {props.state.phase === 'error'
                  ? 'Try again'
                  : 'Start conversation'}
              </Button>
            }
          >
            <Button
              size="xl"
              variant={props.state.muted ? 'accent' : 'outline'}
              label={
                props.state.muted ? 'Unmute microphone' : 'Mute microphone'
              }
              aria-pressed={props.state.muted}
              disabled={!connected()}
              onClick={props.onMute}
              class="rounded-2xl"
            >
              <Show
                when={props.state.muted}
                fallback={<Microphone class="size-5" />}
              >
                <MicrophoneSlash class="size-5" />
              </Show>
            </Button>
            <Button
              variant="strong"
              size="xl"
              class="flex-1 rounded-2xl"
              onClick={props.onEnd}
            >
              End conversation
            </Button>
          </Show>
        </div>
        <p class="mt-4 text-center text-[11px] leading-relaxed text-ink-muted">
          {active()
            ? 'Ending voice keeps your agent’s work running.'
            : 'Your microphone turns on when you start.\nNo audio recording.'}
        </p>
      </div>
    </Dialog>
  );
}
