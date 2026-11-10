import { isPlatform } from '@core/util/platform';
import { Channel, invoke } from '@tauri-apps/api/core';
import { createEffect, on, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { CallState } from '../CallContext';
import { isNativeCallEnabled } from '../native-call-platform';

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
async function startNativeWatch() {
  try {
    await invoke<void>('plugin:call-kit|watch_audio_output', {
      channel: new Channel<AudioOutputState>((state) => {
        for (const subscriber of nativeSubscribers) subscriber(state);
      }),
    });
  } catch (error) {
    nativeWatch = undefined;
    throw error;
  }
}

function watchNativeAudioOutput() {
  nativeWatch ??= startNativeWatch();
  return nativeWatch;
}

type AudioOutputControlState = {
  supported: boolean;
  output: AudioOutputState | null;
};

export function createCallAudioOutput(
  call:
    | Pick<
        CallState,
        | 'activeCallId'
        | 'audioOutputDevices'
        | 'activeAudioOutputDeviceId'
        | 'switchAudioOutput'
      >
    | undefined
) {
  const native =
    isNativeCallEnabled() && (isPlatform('ios') || isPlatform('android'));
  const browserSupported =
    !native &&
    typeof HTMLMediaElement !== 'undefined' &&
    'setSinkId' in HTMLMediaElement.prototype;
  const [state, setState] = createStore<AudioOutputControlState>({
    supported: browserSupported,
    output: null,
  });
  const supported = () => state.supported;
  const output = () => state.output;
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
        setState('output', next);
      }
    };
    nativeSubscribers.add(receive);
    onCleanup(() => nativeSubscribers.delete(receive));
    createEffect(
      on(callId, async (id) => {
        const request = ++revision;
        setState({ output: null, supported: false });
        if (!id) return;
        try {
          await watchNativeAudioOutput();
          if (disposed || callId() !== id) return;
          setState('supported', true);
          const result = await invoke<{ state: AudioOutputState | null }>(
            'plugin:call-kit|get_audio_output'
          );
          if (disposed || callId() !== id) return;
          if (revision === request)
            setState('output', matchingAudioOutputState(id, result.state));
        } catch {
          if (!disposed && callId() === id && revision === request)
            setState('supported', false);
        }
      })
    );
  }

  const outputs = () => {
    if (native) return output()?.outputs ?? [];
    return (
      call?.audioOutputDevices().map((device) => ({
        id: device.deviceId,
        label: device.label,
      })) ?? []
    );
  };
  const selected = () =>
    native ? output()?.selectedId : call?.activeAudioOutputDeviceId();
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
        setState('output', result.state);
    } catch (error) {
      if (
        isMissingAudioOutputCommand(error) &&
        !disposed &&
        callId() === active
      )
        setState('supported', false);
    }
  }

  return { supported, callId, outputs, selected, select };
}
