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
  /** Owned by the call once claimed: published, or stopped if unused. */
  localTracks?: MeetingLocalTracks;
};

/**
 * Claimed by `connect` at the moment it publishes local media, so the waiting
 * room stays live and its toggles keep applying until the call is connected.
 * Never called when the attempt ends before that point.
 */
export type MeetingMediaSource = () => MeetingMediaPreferences;

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
    media: MeetingMediaSource
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
