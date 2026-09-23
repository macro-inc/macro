import type { Accessor } from 'solid-js';
import type { MeetingSessionLifecycle } from './meeting-session-lifecycle';

export type MeetingCredentials = {
  callId: string;
  channelId: string | null;
  roomName: string;
  serverUrl: string;
  token: string;
  participantId: string;
  shareToken: string | null;
};

/** Live waiting-room capture tracks; whoever holds them must stop them. */
export type MeetingLocalTracks = {
  microphone?: MediaStreamTrack;
  camera?: MediaStreamTrack;
};

export type MeetingMediaPreferences = {
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  /** Owned by `connect` once passed; the session stops them on early exits. */
  localTracks?: MeetingLocalTracks;
};

/** The session owns only the connection it joined, including late replies. */
export type MeetingSessionCapabilities = {
  lifecycle: MeetingSessionLifecycle;
  shareToken: Accessor<string>;
  isInCall: Accessor<boolean>;
  activeCallId: Accessor<string | null>;
  /** Prepare a draft before requesting credentials; stop side effects if aborted. */
  prepare?: (signal: AbortSignal) => Promise<void>;
  join: (displayName?: string) => Promise<MeetingCredentials>;
  release: (shareToken: string, token: string) => Promise<unknown>;
  connect: (
    credentials: MeetingCredentials,
    preferences: MeetingMediaPreferences
  ) => Promise<void>;
  disconnect: () => Promise<void>;
};

export type MeetingPageState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | {
      kind: 'ready';
      title: string;
      scheduledStart: string | null;
      scheduledEnd: string | null;
      /** Channel-linked meetings are members-only; guests cannot join them. */
      channelId: string | null;
    };
