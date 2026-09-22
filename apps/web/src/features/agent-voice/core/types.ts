export type VoiceOption = { id: string; label: string };
export type VoiceOptions = {
  enabled: boolean;
  voices: VoiceOption[];
  maxDurationSeconds: number;
};

export type VoiceCredentials = {
  voiceSessionId: string;
  roomName: string;
  url: string;
  token: string;
  participantIdentity: string;
  agentIdentity: string;
  expiresAt: string;
  voice: string;
};

export type VoiceTarget = { sessionId: string; title: string };
export class VoiceStartError extends Error {
  constructor(
    message: string,
    readonly ambiguous: boolean
  ) {
    super(message);
  }
}
export type VoicePhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'requesting-microphone'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'ending'
  | 'error';
export type AgentVoiceState = 'listening' | 'thinking' | 'speaking';
export type Caption = {
  id: string;
  speaker: 'user' | 'agent';
  text: string;
  final: boolean;
};
export type VoiceState = {
  phase: VoicePhase;
  target?: VoiceTarget;
  options?: VoiceOptions;
  voice: string;
  muted: boolean;
  agentState: AgentVoiceState;
  inputLevel: number;
  outputLevel: number;
  captions: Caption[];
  error?: string;
  playbackBlocked: boolean;
  reviewRequired: boolean;
};

export type VoiceMediaEvents = {
  connection: (state: 'connected' | 'reconnecting' | 'disconnected') => void;
  levels: (input: number, output: number) => void;
  caption: (caption: Caption) => void;
  agentState: (state: AgentVoiceState) => void;
  playbackBlocked: (blocked: boolean) => void;
  failure: (message: string) => void;
};
export type VoiceMedia = {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  mute: (muted: boolean) => Promise<void>;
  enablePlayback: () => Promise<void>;
};
/** Local capture acquired before opening a remote voice session. */
export type VoiceMicrophone = {
  track: MediaStreamTrack;
  stop: () => void;
};
export type VoiceSessionObserver = {
  close: () => void;
};
export type VoiceDependencies = {
  options: (sessionId: string) => Promise<VoiceOptions>;
  start: (
    sessionId: string,
    voice: string,
    clientSessionId: string
  ) => Promise<VoiceCredentials>;
  end: (sessionId: string, voiceSessionId: string) => Promise<void>;
  acquireMicrophone: () => Promise<() => void>;
  requestMicrophone: () => Promise<VoiceMicrophone>;
  callActive: () => boolean;
  media: (
    credentials: VoiceCredentials,
    events: VoiceMediaEvents,
    microphone: VoiceMicrophone
  ) => Promise<VoiceMedia>;
  observeSession: (
    sessionId: string,
    reviewRequired: (required: boolean) => void
  ) => Promise<VoiceSessionObserver>;
  uuid: () => string;
};
