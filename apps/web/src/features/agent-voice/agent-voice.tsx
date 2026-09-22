import { useCallContext } from '@channel/Call/CallContext';
import { useUserId } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { isPlatform } from '@core/util/platform';
import Waveform from '@phosphor-icons/core/regular/waveform.svg?component-solid';
import { Button } from '@ui';
import { createEffect, onCleanup, type ParentProps, Show } from 'solid-js';
import { VoicePanel } from './components/VoicePanel';
import { useAgentVoice, VoiceContext } from './context/voice-context';
import { createVoiceSession } from './primitives/create-voice-session';
import { createLivekitVoiceMedia } from './queries/livekit-media';
import { requestVoiceMicrophone } from './queries/microphone';
import { acquireVoiceMicrophone } from './queries/microphone-lease';
import { createAgentVoiceBridge } from './queries/session-bridge';
import { voiceSource } from './queries/voice-source';

/** Production composition. Mounted once above routes so navigation keeps audio. */
export function AgentVoiceProvider(props: ParentProps) {
  const call = useCallContext();
  const userId = useUserId();
  const callActive = () => call.isInCall() || call.isConnecting();
  const controller = createVoiceSession({
    ...voiceSource,
    acquireMicrophone: acquireVoiceMicrophone,
    requestMicrophone: requestVoiceMicrophone,
    callActive,
    media: createLivekitVoiceMedia,
    bridge: (sessionId, publish) => {
      const user = userId();
      if (!user)
        return Promise.reject(new Error('Sign in again to start voice.'));
      return createAgentVoiceBridge(sessionId, user, publish);
    },
    uuid: () => crypto.randomUUID(),
  });
  // Synchronize the independent RTC systems; a human call always releases voice.
  createEffect(() => {
    if (
      callActive() &&
      controller.active() &&
      controller.state().phase !== 'ending'
    )
      void controller.end('Voice paused because a call started.');
  });
  createEffect(() => {
    if (
      !userId() &&
      controller.active() &&
      controller.state().phase !== 'ending'
    )
      void controller.end();
  });
  const unload = () => controller.dispose();
  window.addEventListener('pagehide', unload);
  onCleanup(() => {
    window.removeEventListener('pagehide', unload);
    controller.dispose();
  });
  return (
    <VoiceContext.Provider value={controller}>
      {props.children}
      <VoicePanel
        open={controller.visible()}
        state={controller.state()}
        onClose={controller.hide}
        onStart={() => void controller.start()}
        onEnd={() => void controller.end()}
        onMute={() => void controller.toggleMute()}
        onVoice={controller.selectVoice}
        onEnablePlayback={() => void controller.enablePlayback()}
      />
      <Show when={controller.active() && !controller.visible()}>
        <div class="fixed bottom-6 left-1/2 z-modal -translate-x-1/2 rounded-full border border-edge-muted bg-dialog p-1 shadow-lg">
          <Button
            variant="ghost"
            class="rounded-full px-4"
            label="Open voice conversation"
            onClick={controller.show}
          >
            <Waveform class="size-4 text-accent" />
            <span>Voice is on</span>
            <span class="size-1.5 rounded-full bg-success" />
          </Button>
        </div>
      </Show>
    </VoiceContext.Provider>
  );
}

/** Shared composer slot covers the agents view and standalone agent block. */
export function AgentVoiceButton(props: {
  sessionId?: string;
  title?: string;
  harness?: string;
  canEdit?: boolean;
  disabled?: boolean;
}) {
  const voice = useAgentVoice();
  const eligible = () =>
    voice &&
    isPlatform('web') &&
    !isMobile() &&
    props.canEdit &&
    (props.harness === 'in-memory' || props.harness === 'macro-inmem');
  return (
    <Show when={eligible()}>
      <Button
        variant="ghost"
        size="icon-composer"
        label="Talk to Macro"
        disabled={!props.sessionId || props.disabled}
        onClick={() => {
          if (props.sessionId)
            void voice?.open({
              sessionId: props.sessionId,
              title: props.title || 'Your Macro agent',
            });
        }}
      >
        <Waveform />
      </Button>
    </Show>
  );
}
