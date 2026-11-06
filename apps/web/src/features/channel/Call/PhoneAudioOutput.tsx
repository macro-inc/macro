import { t } from '@app/lib/i18n';
import { isNativeCallEnabled } from '@channel/Call/native-call-platform';
import { fireAndForget } from '@core/util/fireAndForget';
import { isPlatform } from '@core/util/platform';
import Speaker from '@icon/system/regular/speaker-high.svg';
import { Channel, invoke } from '@tauri-apps/api/core';
import { Dropdown, SingleSelectCheck } from '@ui';
import { createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js';
import { useCallContextOptional } from './CallContext';

export type AudioOutputState = {
  callId: string;
  selectedId: string | null;
  outputs: { id: string; label: string }[];
};

export function isMissingAudioOutputCommand(error: unknown): boolean {
  return (
    typeof error === 'string' &&
    /^Command (get_audio_output|watch_audio_output|select_audio_output) not found$/.test(
      error
    )
  );
}

export function matchingAudioOutputState(
  callId: string | null,
  state: AudioOutputState | null
): AudioOutputState | null {
  return callId && state?.callId.toLowerCase() === callId.toLowerCase()
    ? state
    : null;
}

// One native channel per webview; unmounting removes only this surface's subscriber.
const nativeSubscribers = new Set<(state: AudioOutputState) => void>();
let nativeWatch: Promise<void> | undefined;
function watchNativeAudioOutput() {
  nativeWatch ??= invoke<void>('plugin:call-kit|watch_audio_output', {
    channel: new Channel<AudioOutputState>((state) => {
      for (const subscriber of nativeSubscribers) subscriber(state);
    }),
  }).catch((error: unknown) => {
    nativeWatch = undefined;
    throw error;
  });
  return nativeWatch;
}

/** The native session owns its output; browser media uses the CallContext device picker. */
export function PhoneAudioOutput() {
  const call = useCallContextOptional();
  const native =
    isNativeCallEnabled() && (isPlatform('ios') || isPlatform('android'));
  const browserSupported =
    !native &&
    typeof HTMLMediaElement !== 'undefined' &&
    'setSinkId' in HTMLMediaElement.prototype;
  const [supported, setSupported] = createSignal(browserSupported);
  const [state, setState] = createSignal<AudioOutputState | null>(null);
  const callId = () => call?.activeCallId() ?? null;
  let disposed = false;
  let revision = 0;
  onCleanup(() => {
    disposed = true;
  });

  if (native) {
    const receive = (next: AudioOutputState) => {
      if (!disposed && matchingAudioOutputState(callId(), next)) {
        revision++;
        setState(next);
      }
    };
    nativeSubscribers.add(receive);
    onCleanup(() => nativeSubscribers.delete(receive));
    createEffect(
      on(callId, async (id) => {
        const request = ++revision;
        setState(null);
        setSupported(false);
        if (!id) return;
        try {
          await watchNativeAudioOutput();
          if (disposed || callId() !== id) return;
          setSupported(true);
          const result = await invoke<{ state: AudioOutputState | null }>(
            'plugin:call-kit|get_audio_output'
          );
          if (disposed || callId() !== id) return;
          if (revision === request)
            setState(matchingAudioOutputState(id, result.state));
        } catch {
          if (!disposed && callId() === id && revision === request)
            setSupported(false);
        }
      })
    );
  }

  const outputs = () =>
    native
      ? (state()?.outputs ?? [])
      : (call
          ?.audioOutputDevices()
          .map((device) => ({ id: device.deviceId, label: device.label })) ??
        []);
  const selected = () =>
    native ? state()?.selectedId : call?.activeAudioOutputDeviceId();
  async function select(id: string) {
    if (!native) return call?.switchAudioOutput(id);
    const active = callId();
    if (!active) return;
    const request = ++revision;
    try {
      const result = await invoke<{ state: AudioOutputState | null }>(
        'plugin:call-kit|select_audio_output',
        { callId: active, id }
      );
      if (
        !disposed &&
        callId() === active &&
        revision === request &&
        matchingAudioOutputState(active, result.state)
      )
        setState(result.state);
    } catch (error) {
      if (
        isMissingAudioOutputCommand(error) &&
        !disposed &&
        callId() === active
      )
        setSupported(false);
    }
  }

  return (
    <Show when={supported() && !!callId() && outputs().length > 0}>
      <Dropdown placement="bottom-end">
        <Dropdown.Trigger
          variant="ghost"
          size="icon-lg"
          class="rounded-full bg-surface-2"
          aria-label={t('calls.audioOutput')}
          tooltip={t('calls.audioOutput')}
        >
          <Speaker class="size-5" />
        </Dropdown.Trigger>
        <Dropdown.Content
          portalScope="local"
          class="min-w-56 max-w-[calc(100vw-2rem)]"
        >
          <Dropdown.Group>
            <Dropdown.GroupLabel>{t('calls.audioOutput')}</Dropdown.GroupLabel>
            <Dropdown.RadioGroup
              value={selected() ?? ''}
              onChange={(id) => fireAndForget(select(id), 'call.audio-output')}
            >
              <For each={outputs()}>
                {(output) => (
                  <Dropdown.RadioItem value={output.id} closeOnSelect>
                    <SingleSelectCheck active={selected() === output.id} />
                    <span class="min-w-0 flex-1 truncate">{output.label}</span>
                  </Dropdown.RadioItem>
                )}
              </For>
            </Dropdown.RadioGroup>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}
