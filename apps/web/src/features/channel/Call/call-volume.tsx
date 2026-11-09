import type { RemoteParticipant } from 'livekit-client';
import {
  createContext,
  createSignal,
  type ParentProps,
  useContext,
} from 'solid-js';
import { LK_TRACK_SOURCE } from './livekit-loader';

/** LiveKit owns microphone gain; one call-wide version notifies every view. */
export function createCallVolumeState() {
  const [version, setVersion] = createSignal(0);
  return {
    level(participant: {
      identity: string;
      getVolume?: RemoteParticipant['getVolume'];
    }) {
      version();
      return participant.getVolume?.(LK_TRACK_SOURCE.Microphone) ?? 1;
    },
    set(participant: RemoteParticipant, value: number) {
      if (!Number.isFinite(value)) return;
      participant.setVolume(
        Math.max(0, Math.min(1, value)),
        LK_TRACK_SOURCE.Microphone
      );
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
