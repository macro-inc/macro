import type { RemoteParticipant } from 'livekit-client';
import {
  createContext,
  createSignal,
  type ParentProps,
  useContext,
} from 'solid-js';
import { LK_TRACK_SOURCE } from './livekit-loader';

/** Track explicit playback choices separately from SDK gain defaults. */
export function createCallVolumeState() {
  const [version, setVersion] = createSignal(0);
  const choices = new WeakMap<object, number>();
  return {
    level(participant: {
      identity: string;
      getVolume?: RemoteParticipant['getVolume'];
    }) {
      version();
      const chosen = choices.get(participant);
      if (chosen !== undefined) return chosen;
      const reported = participant.getVolume?.(LK_TRACK_SOURCE.Microphone);
      return reported !== undefined && Number.isFinite(reported) && reported > 0
        ? reported
        : 1;
    },
    set(participant: RemoteParticipant, value: number) {
      if (!Number.isFinite(value)) return;
      const level = Math.max(0, Math.min(1, value));
      participant.setVolume(level, LK_TRACK_SOURCE.Microphone);
      choices.set(participant, level);
      setVersion((value) => value + 1);
    },
  };
}
const CallVolumeContext =
  createContext<ReturnType<typeof createCallVolumeState>>();
export function CallVolumeProvider(props: ParentProps) {
  const state = createCallVolumeState();
  return (
    <CallVolumeContext.Provider value={state}>
      {props.children}
    </CallVolumeContext.Provider>
  );
}
export const useCallVolumeOptional = () => useContext(CallVolumeContext);
