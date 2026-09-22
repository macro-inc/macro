import type { Accessor } from 'solid-js';

export type MeetingCredentials = {
  callId: string;
  channelId: string | null;
  roomName: string;
  serverUrl: string;
  token: string;
  participantId: string;
  shareToken: string | null;
};

export type MeetingMediaPreferences = {
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
};

/** The session owns only the connection it joined, including late replies. */
export type MeetingSessionCapabilities = {
  shareToken: Accessor<string>;
  isInCall: Accessor<boolean>;
  activeCallId: Accessor<string | null>;
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
