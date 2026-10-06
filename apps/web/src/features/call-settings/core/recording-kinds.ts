/** The kinds of call the recording settings tell apart. */
export type RecordingKind = 'huddles' | 'internalMeetings' | 'externalMeetings';

/** One flag per {@link RecordingKind}. */
export type RecordingKinds = Record<RecordingKind, boolean>;

export type TeamRecordingPolicy = {
  /** Kinds no one on the team may record. */
  blocked: RecordingKinds;
  /** Team admins and owners may change the blocks. */
  canEdit: boolean;
};

export type RecordingSettings = {
  /** Kinds of call the viewer's own calls record by default. */
  recordByDefault: RecordingKinds;
  /** Absent when the viewer is not on a team. */
  team: TeamRecordingPolicy | null;
};

export type RecordingKindOption = {
  kind: RecordingKind;
  label: string;
  description: string;
};

export const RECORDING_KINDS: readonly RecordingKindOption[] = [
  {
    kind: 'huddles',
    label: 'Huddles',
    description: 'Calls started from a channel.',
  },
  {
    kind: 'internalMeetings',
    label: 'Internal meetings',
    description: 'Meetings with only people on your team.',
  },
  {
    kind: 'externalMeetings',
    label: 'External meetings',
    description: 'Meetings that guests or people outside your team join.',
  },
];

/** Whether the viewer's team forbids recording `kind`. */
export function isBlockedByTeam(
  settings: RecordingSettings,
  kind: RecordingKind
): boolean {
  return settings.team?.blocked[kind] ?? false;
}

/**
 * Whether the viewer's calls of `kind` start recording: they chose it and
 * their team allows it.
 */
export function recordsByDefault(
  settings: RecordingSettings,
  kind: RecordingKind
): boolean {
  return settings.recordByDefault[kind] && !isBlockedByTeam(settings, kind);
}

/** `kinds` with one kind changed; the input is left untouched. */
export function withKind(
  kinds: RecordingKinds,
  kind: RecordingKind,
  value: boolean
): RecordingKinds {
  return { ...kinds, [kind]: value };
}
