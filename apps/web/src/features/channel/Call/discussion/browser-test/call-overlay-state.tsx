import type { BackgroundEffect } from '@core/media/background-effect';
import { fireAndForget } from '@core/util/fireAndForget';
import { createClient, fetchExchange } from '@urql/core';
import { createSignal, type ParentProps } from 'solid-js';
import { createCallMediaPermissions } from '../../call-media-permissions';

const params = new URLSearchParams(location.search);
if (params.has('layout'))
  localStorage.setItem('call.layout', JSON.stringify(params.get('layout')));
const callId = '00000000-0000-7000-8000-0000000ca110';
const channelId = '00000000-0000-7000-8000-00000000c0c0';
let permissions: ReturnType<typeof createCallMediaPermissions> | undefined;
const [backgroundEffect, setBackgroundEffect] = createSignal<BackgroundEffect>({
  type: 'none',
});
const [audioMuted, setAudioMuted] = createSignal(true);
const [connecting, setConnecting] = createSignal(
  params.get('connecting') === 'true'
);
window.addEventListener('fixture-connecting', () => setConnecting(true));
const [videoMuted, setVideoMuted] = createSignal(params.get('media') !== 'on');
const [screenSharing, setScreenSharing] = createSignal(
  ['local', 'both'].includes(params.get('share') ?? '')
);
const [shareAudio, setShareAudio] = createSignal(false);
const [noiseSuppressed, setNoiseSuppressed] = createSignal(false);

function videoTrack(name: string, portrait = false) {
  const width = portrait ? 720 : 1280;
  const height = portrait ? 1280 : 720;
  const attached: HTMLCanvasElement[] = [];
  return {
    dimensions: { width, height },
    mediaStreamTrack: { getSettings: () => ({ width, height }) },
    attach() {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.dataset.fixtureTrack = name;
      const context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = '#303942';
        context.fillRect(0, 0, width, height);
        context.fillStyle = '#e4e6e8';
        context.font = '36px sans-serif';
        context.fillText(name, 40, 70);
      }
      attached.push(canvas);
      return canvas;
    },
    detach() {
      return attached.splice(0);
    },
  };
}
const total = Number(params.get('count') ?? 2);
const participants = Array.from(
  { length: Math.max(0, total - 1) },
  (_, index) => {
    const identity =
      index === 0
        ? 'macro|member@example.com'
        : `macro|member${index + 1}@example.com`;
    const name = params.has('count')
      ? `Participant ${index + 1}`
      : 'Call participant';
    const camera = videoTrack(
      name,
      params.get('portrait') === 'true' && index === 0
    );
    const screen = videoTrack(`Shared screen ${index + 1}`);
    let volume = params.get('sdkVolume') === 'zero' ? 0 : 1;
    return {
      identity,
      name,
      isAgent: false,
      getTrackPublication(source: string) {
        if (source === 'microphone')
          return { isMuted: params.get('mic') !== 'on', isSubscribed: true };
        if (source === 'camera' && params.get('media') === 'on')
          return { track: camera, isMuted: false, isSubscribed: true };
        if (
          source === 'screen_share' &&
          ((['remote', 'both'].includes(params.get('share') ?? '') &&
            index === 0) ||
            (params.get('share') === 'remote-pair' && index < 2))
        )
          return { track: screen, isMuted: false, isSubscribed: true };
        return undefined;
      },
      getVolume: () => volume,
      setVolume: (value: number) => {
        volume = value;
      },
    };
  }
);
const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
const localCamera = videoTrack('You');
const [previewCapture, setPreviewCapture] = createSignal<MediaStream>();
if (params.get('cameraPreview') === 'true') {
  fireAndForget(
    (async () =>
      setPreviewCapture(
        await navigator.mediaDevices.getUserMedia({ video: true })
      ))(),
    'camera-preview-fixture'
  );
}
const localParticipant = {
  identity: 'macro|me@example.com',
  getTrackPublication(source: string) {
    if (source === 'camera' && !videoMuted())
      return {
        track: {
          ...localCamera,
          mediaStream: params.has('processedPreview')
            ? undefined
            : previewCapture(),
          mediaStreamTrack: params.has('processedPreview')
            ? { readyState: 'ended' }
            : (previewCapture()?.getVideoTracks()[0] ??
              localCamera.mediaStreamTrack),
          getProcessor: params.has('processedPreview')
            ? () => ({ source: previewCapture()?.getVideoTracks()[0] })
            : undefined,
        },
        isMuted: false,
        isSubscribed: true,
      };
    return undefined;
  },
  publishData: async () => {},
};
const room = {
  on(name: string, listener: (...args: unknown[]) => void) {
    const group = listeners.get(name) ?? new Set();
    group.add(listener);
    listeners.set(name, group);
    return room;
  },
  off(name: string, listener: (...args: unknown[]) => void) {
    listeners.get(name)?.delete(listener);
    return room;
  },
  localParticipant,
};
window.addEventListener('fixture-reaction', () => {
  const payload = new TextEncoder().encode(
    JSON.stringify({ version: 1, emoji: '👍' })
  );
  for (const listener of listeners.get('dataReceived') ?? [])
    listener(
      payload,
      participants[0] ?? { identity: 'macro|member@example.com' },
      undefined,
      'macro.call.reaction.v1'
    );
});
async function captureMedia(
  device: 'microphone' | 'camera',
  enabled: boolean
): Promise<void> {
  await permissions?.capture(device, async () => {
    if (params.get('capture') === 'permissions' && enabled) {
      const permission = await navigator.permissions.query({
        name: device as PermissionName,
      });
      if (permission.state !== 'granted')
        throw new DOMException('Device blocked', 'NotAllowedError');
    } else if (params.get('capture') === 'true' && enabled) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: device === 'microphone',
        video: device === 'camera',
      });
      stream.getTracks().forEach((track) => track.stop());
    } else if (
      (device === 'microphone'
        ? permissions?.microphone()
        : permissions?.camera()) === 'denied'
    ) {
      throw new DOMException('Device blocked', 'NotAllowedError');
    }
    if (device === 'microphone') setAudioMuted(!enabled);
    else setVideoMuted(!enabled);
  });
}
const call = {
  activeCallId: () => callId,
  callLifecycle: {
    getState: () => ({ t: 'active', call: { channelId, callId } }),
    onLeave: () => () => {},
  },
  leaveCall: async () => {},
  joinError: () => null,
  activeChannelId: () => channelId,
  isInCall: () => true,
  trackVersion: () => 0,
  connectionState: () => 'connected',
  room: () => room,
  remoteParticipants: () =>
    new Map(
      participants.map((participant) => [participant.identity, participant])
    ),
  isLocalSpeaking: () => false,
  isParticipantSpeaking: () => params.get('speaking') === 'true',
  isConnecting: connecting,
  isAudioMuted: audioMuted,
  microphonePermission: () => permissions?.microphone() ?? 'prompt',
  cameraPermission: () => permissions?.camera() ?? 'prompt',
  isVideoMuted: videoMuted,
  isScreenSharing: screenSharing,
  toggleAudio: async (enabled?: boolean) =>
    captureMedia('microphone', enabled ?? audioMuted()),
  toggleVideo: async (enabled?: boolean) =>
    captureMedia('camera', enabled ?? videoMuted()),
  toggleScreenShare: async () => {
    setScreenSharing(!screenSharing());
  },
  shareScreenAudio: shareAudio,
  setShareScreenAudio: setShareAudio,
  audioInputDevices: () => [],
  audioOutputDevices: () =>
    params.has('output')
      ? [{ deviceId: 'default', label: 'Default output', kind: 'audiooutput' }]
      : [],
  videoInputDevices: () => [],
  activeAudioInputDeviceId: () => '',
  activeAudioOutputDeviceId: () => '',
  activeVideoInputDeviceId: () => '',
  switchAudioInput: async () => {},
  switchAudioOutput: async () => {},
  switchVideoInput: async () => {},
  isNoiseSuppressed: noiseSuppressed,
  toggleNoiseSuppression: async () => {
    setNoiseSuppressed(!noiseSuppressed());
  },
  backgroundEffect,
  setBackgroundEffect: async (effect: BackgroundEffect) => {
    setBackgroundEffect(effect);
  },
  isSharedWithTeam: () => false,
};
export const CallProvider = (props: ParentProps) => props.children;
export const useCallContext = () => {
  permissions ??= createCallMediaPermissions({
    onGranted: (device) => captureMedia(device, true),
  });
  return call;
};
export const useCallContextOptional = () => call;

// Only transport and the feature flag are substituted; the Work controller stays real.
export const useFeatureFlag = () => () => ({
  enabled: params.get('work') !== 'off',
  loading: false,
});
const client = createClient({
  url: '/fixture/work',
  exchanges: [fetchExchange],
});
export const useWorkClient = () => () => client;
