export type GranolaScope = 'personal' | 'public' | 'all' | 'workspace';

export type GranolaSyncStatus = {
  connected: boolean;
  enabled: boolean;
  scope: GranolaScope | null;
  startedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

export type ImportedMeeting = {
  id: string;
  title: string | null;
  startedAt: string | null;
  createdAt: string;
};

/** Fields displayed from the provider-independent call record response. */
export type ImportedMeetingRecord = {
  entity: ImportedMeeting;
  sources: {
    provider: 'macro' | 'granola';
    externalUrl: string | null;
    metadata: Record<string, unknown>;
  }[];
  participants: {
    id: string;
    displayName: string | null;
    email: string | null;
  }[];
  transcripts: {
    id: string;
    segments: {
      sequenceNum: number;
      speakerLabel: string | null;
      content: string;
    }[];
  }[];
};
