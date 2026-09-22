import { createSignal } from 'solid-js';
import type {
  VoiceBridge,
  VoiceCredentials,
  VoiceDependencies,
  VoiceMedia,
  VoiceState,
  VoiceTarget,
} from '../core/types';
import { VoiceStartError } from '../core/types';

const initial: VoiceState = {
  phase: 'idle',
  voice: 'marin',
  muted: false,
  agentState: 'listening',
  inputLevel: 0,
  outputLevel: 0,
  captions: [],
  playbackBlocked: false,
  reviewRequired: false,
};
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Voice disconnected. Please try again.';

/** Owns media resources independently of the page displaying the agent session. */
export function createVoiceSession(deps: VoiceDependencies) {
  const [state, setState] = createSignal<VoiceState>({ ...initial });
  const [visible, setVisible] = createSignal(false);
  let generation = 0;
  let closeActive: (() => Promise<void>) | undefined;
  let mutedVersion = 0;
  const pendingStarts = new Map<
    string,
    { id: string; voice: string; inFlight: boolean }
  >();
  const patch = (next: Partial<VoiceState>) =>
    setState((value) => ({ ...value, ...next }));
  const active = () =>
    ['connecting', 'connected', 'reconnecting', 'ending'].includes(
      state().phase
    );

  const end = async (message?: string) => {
    const current = ++generation;
    mutedVersion++;
    const close = closeActive;
    closeActive = undefined;
    patch({ phase: 'ending', inputLevel: 0, outputLevel: 0 });
    try {
      await close?.();
    } finally {
      if (current === generation)
        patch({
          phase: message ? 'error' : 'ready',
          error: message,
          muted: false,
          playbackBlocked: false,
          reviewRequired: false,
        });
    }
  };

  const open = async (target: VoiceTarget) => {
    setVisible(true);
    if (active()) return;
    const current = ++generation;
    patch({
      ...initial,
      options: undefined,
      voice: state().voice,
      phase: 'loading',
      target,
    });
    try {
      const options = await deps.options(target.sessionId);
      if (current !== generation) return;
      patch({
        options,
        phase: 'ready',
        voice: options.voices.some((option) => option.id === state().voice)
          ? state().voice
          : (options.voices[0]?.id ?? 'marin'),
      });
    } catch (error) {
      if (current === generation)
        patch({ phase: 'error', error: errorMessage(error) });
    }
  };

  let media: VoiceMedia | undefined;
  const start = async () => {
    const value = state();
    if (!value.target || active()) return;
    if (!value.options) {
      await open(value.target);
      return;
    }
    if (!value.options.enabled) return;
    if (deps.callActive()) {
      patch({
        phase: 'error',
        error: 'Leave your call before starting voice.',
      });
      return;
    }
    const current = ++generation;
    const target = value.target;
    patch({
      phase: 'connecting',
      error: undefined,
      captions: [],
      muted: false,
      reviewRequired: false,
    });
    let release: (() => void) | undefined;
    let credentials: VoiceCredentials | undefined;
    let bridge: VoiceBridge | undefined;
    let ownMedia: VoiceMedia | undefined;
    const reviews = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const close = async () => {
      clearTimeout(timer);
      timer = undefined;
      const closingBridge = bridge;
      bridge = undefined;
      const closingMedia = ownMedia;
      ownMedia = undefined;
      const releasing = release;
      release = undefined;
      const closingCredentials = credentials;
      credentials = undefined;
      closingBridge?.close();
      try {
        await closingMedia?.disconnect();
      } catch {
        // Always release the remaining resources, including microphone ownership.
      }
      if (media === closingMedia) media = undefined;
      releasing?.();
      if (closingCredentials) {
        try {
          await deps.end(target.sessionId, closingCredentials.voiceSessionId);
        } catch {
          // The worker also ends on participant departure and an absolute deadline.
        }
      }
    };
    closeActive = close;
    const stale = () => current !== generation;
    try {
      release = await deps.acquireMicrophone();
      if (stale()) {
        await close();
        return;
      }
      const prior = pendingStarts.get(target.sessionId);
      const attempt =
        prior && !prior.inFlight
          ? prior
          : { id: deps.uuid(), voice: value.voice, inFlight: false };
      pendingStarts.set(target.sessionId, attempt);
      attempt.inFlight = true;
      patch({ voice: attempt.voice });
      try {
        credentials = await deps.start(
          target.sessionId,
          attempt.voice,
          attempt.id
        );
        if (pendingStarts.get(target.sessionId) === attempt)
          pendingStarts.delete(target.sessionId);
      } catch (error) {
        if (
          error instanceof VoiceStartError &&
          !error.ambiguous &&
          pendingStarts.get(target.sessionId) === attempt
        )
          pendingStarts.delete(target.sessionId);
        throw error;
      } finally {
        attempt.inFlight = false;
      }
      if (stale()) {
        await close();
        return;
      }
      bridge = await deps.bridge(target.sessionId, (event) => {
        if (stale()) return;
        if (event.type === 'interaction') reviews.add(event.taskId);
        else reviews.delete(event.taskId);
        patch({ reviewRequired: reviews.size > 0 });
        async function publish() {
          try {
            await ownMedia?.publish(event);
          } catch {
            if (!stale())
              await end(
                'The connection to your agent was lost. Reconnect to continue.'
              );
          }
        }
        void publish();
      });
      if (stale()) {
        await close();
        return;
      }
      ownMedia = await deps.media(
        credentials,
        {
          connection: (connection) => {
            if (stale()) return;
            if (connection === 'disconnected')
              void end('Voice disconnected. Your agent work can continue.');
            else patch({ phase: connection });
          },
          levels: (inputLevel, outputLevel) => {
            if (!stale()) patch({ inputLevel, outputLevel });
          },
          caption: (caption) => {
            if (stale()) return;
            const captions = state().captions.filter(
              (item) => item.id !== caption.id
            );
            patch({ captions: [...captions, caption].slice(-24) });
          },
          agentState: (agentState) => {
            if (!stale()) patch({ agentState });
          },
          playbackBlocked: (playbackBlocked) => {
            if (!stale()) patch({ playbackBlocked });
          },
          failure: (message) => {
            if (!stale()) void end(message);
          },
        },
        {
          request: (request) => {
            if (stale() || !bridge)
              return Promise.reject(new Error('This voice session has ended.'));
            return bridge.request(request);
          },
          cancel: (request) => {
            if (stale() || !bridge)
              return Promise.reject(new Error('This voice session has ended.'));
            return bridge.cancel(request);
          },
          context: () => {
            if (stale() || !bridge)
              return Promise.reject(new Error('This voice session has ended.'));
            return bridge.context();
          },
          close: () => {},
        }
      );
      if (stale()) {
        await close();
        return;
      }
      media = ownMedia;
      await ownMedia.connect();
      if (stale()) {
        await close();
        return;
      }
      patch({ phase: 'connected' });
      timer = setTimeout(() => {
        if (!stale())
          void end(
            'This voice session reached its time limit. Start again to continue.'
          );
      }, value.options.maxDurationSeconds * 1000);
    } catch (error) {
      await close();
      if (!stale()) {
        closeActive = undefined;
        patch({ phase: 'error', error: errorMessage(error) });
      }
    }
  };
  const toggleMute = async () => {
    if (!media || state().phase !== 'connected') return;
    const version = ++mutedVersion;
    const muted = !state().muted;
    patch({ muted });
    try {
      await media.mute(muted);
    } catch (error) {
      if (version === mutedVersion)
        patch({ muted: !muted, error: errorMessage(error) });
    }
  };
  return {
    state,
    visible,
    active,
    open,
    start,
    end,
    toggleMute,
    selectVoice: (voice: string) => {
      if (
        !active() &&
        state().options?.voices.some((option) => option.id === voice)
      )
        patch({ voice });
    },
    hide: () => setVisible(false),
    show: () => setVisible(true),
    enablePlayback: async () => {
      try {
        await media?.enablePlayback();
      } catch {
        patch({
          error:
            'Audio is still blocked. Check your browser audio permissions.',
        });
      }
    },
    dispose: () => {
      void end();
    },
  };
}
export type VoiceController = ReturnType<typeof createVoiceSession>;
