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

export type AgentRequest = { version: 1; requestId: string; prompt: string };
export type AgentTaskEvent = {
  version: 1;
  taskId: string;
  type: 'progress' | 'interaction' | 'completed' | 'cancelled' | 'failed';
  text: string;
};
export type AgentTaskAccepted = {
  taskId: string;
  status: 'accepted' | 'queued' | 'running' | 'failed' | 'conflict';
  message?: string;
};
export type AgentCancel = {
  version: 1;
  requestId: string;
  taskId: string;
  replacementPrompt?: string;
};
export type AgentCancelled = {
  status: 'stopping' | 'replaced' | 'already_completed' | 'conflict' | 'failed';
  replacementTaskId?: string;
  message?: string;
};
export type VoiceContext = {
  version: 1;
  sessionId: string;
  messages: { role: 'user' | 'assistant'; text: string }[];
  activeTaskId?: string;
  pendingInteraction?: string;
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
  publish: (event: AgentTaskEvent) => Promise<void>;
};
/** Local capture acquired before opening a remote voice session. */
export type VoiceMicrophone = {
  track: MediaStreamTrack;
  stop: () => void;
};
export type VoiceBridge = {
  request: (request: AgentRequest) => Promise<AgentTaskAccepted>;
  cancel: (request: AgentCancel) => Promise<AgentCancelled>;
  context: () => Promise<VoiceContext>;
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
    bridge: VoiceBridge,
    microphone: VoiceMicrophone
  ) => Promise<VoiceMedia>;
  bridge: (
    sessionId: string,
    publish: (event: AgentTaskEvent) => void
  ) => Promise<VoiceBridge>;
  uuid: () => string;
};
