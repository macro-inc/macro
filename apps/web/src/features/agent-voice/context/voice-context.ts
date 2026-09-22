import { createContext, useContext } from 'solid-js';
import type { VoiceController } from '../primitives/create-voice-session';

export const VoiceContext = createContext<VoiceController>();
export function useAgentVoice() {
  const context = useContext(VoiceContext);
  if (!context) throw new Error('AgentVoiceProvider is missing.');
  return context;
}
