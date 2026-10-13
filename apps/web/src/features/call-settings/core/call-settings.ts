/** The kinds of call the recording settings tell apart. */
export type RecordingKind =
  | 'huddles'
  | 'oneOnOnes'
  | 'internalMeetings'
  | 'externalMeetings';

/** One flag per {@link RecordingKind}. */
export type RecordingKinds = Record<RecordingKind, boolean>;

/**
 * Who can open a call's recording, transcript and notes once it ends: the
 * people who joined, everyone in its channel, everyone invited, or the whole
 * team.
 */
export type ShareAudience = 'participants' | 'channel' | 'invited' | 'team';

/** One audience per {@link RecordingKind}. */
export type ShareByDefault = Record<RecordingKind, ShareAudience>;

export type TeamCallPolicy = {
  /** Kinds no one on the team may record. */
  recordingBlocked: RecordingKinds;
  /** No huddle, direct messages included, may be shared with the team. */
  huddleSharingBlocked: boolean;
  /** Team admins and owners may change the blocks. */
  canEdit: boolean;
};

export type CallSettings = {
  /** Kinds of call the viewer's own calls record by default. */
  recordByDefault: RecordingKinds;
  /** Who each kind of call the viewer hosts is shared with once it ends. */
  shareByDefault: ShareByDefault;
  /** The viewer refuses being recorded or transcribed in 1:1s. */
  refuseOneOnOneRecording: boolean;
  /** Absent when the viewer is not on a team. */
  team: TeamCallPolicy | null;
};

export type RecordingKindOption = {
  kind: RecordingKind;
  label: string;
  description: string;
  /** The team policy row that blocks recording this kind. */
  blockLabel: string;
  /** The audiences this kind can be shared with, narrowest first. */
  audiences: readonly ShareAudience[];
};

export const RECORDING_KINDS: readonly RecordingKindOption[] = [
  {
    kind: 'huddles',
    label: 'Huddles',
    description:
      'Calls started from a channel, other than a direct message with one person.',
    blockLabel: 'Block recording huddles',
    audiences: ['channel', 'team'],
  },
  {
    kind: 'oneOnOnes',
    label: 'DM huddles and 1:1 meetings',
    description:
      'Huddles in a direct message with one person, and meeting links only you and one teammate join.',
    blockLabel: 'Block recording 1:1 meetings',
    audiences: ['participants', 'team'],
  },
  {
    kind: 'internalMeetings',
    label: 'Internal meetings',
    description: 'Meeting links three or more teammates join.',
    blockLabel: 'Block recording internal meetings',
    audiences: ['participants', 'invited', 'team'],
  },
  {
    kind: 'externalMeetings',
    label: 'External meetings',
    description: 'Meeting links that guests or people outside your team join.',
    blockLabel: 'Block recording external meetings',
    audiences: ['participants', 'invited', 'team'],
  },
];

export const SHARE_AUDIENCE_LABELS: Record<ShareAudience, string> = {
  participants: 'Participants only',
  channel: 'People in the channel',
  invited: 'Everyone invited',
  team: 'My whole team',
};

/** Whether the viewer's team forbids recording `kind`. */
export function isRecordingBlocked(
  settings: CallSettings,
  kind: RecordingKind
): boolean {
  return settings.team?.recordingBlocked[kind] ?? false;
}

/**
 * Whether the viewer's calls of `kind` start recording: they chose it and
 * their team allows it.
 */
export function recordsByDefault(
  settings: CallSettings,
  kind: RecordingKind
): boolean {
  return settings.recordByDefault[kind] && !isRecordingBlocked(settings, kind);
}

/** Whether the viewer's team forbids sharing huddles with it. */
export function isHuddleSharingBlocked(settings: CallSettings): boolean {
  return settings.team?.huddleSharingBlocked ?? false;
}

/**
 * Who the viewer's huddles of `kind` are shared with: their choice, except
 * that a team block keeps channel huddles in their channel. Direct-message
 * huddles under a block stay between their two people, but 1:1 meetings are
 * not huddles, so their choice still shows.
 */
export function shareAudience(
  settings: CallSettings,
  kind: RecordingKind
): ShareAudience {
  const audience = settings.shareByDefault[kind];
  if (kind === 'huddles' && isHuddleSharingBlocked(settings)) return 'channel';
  return audience;
}

/** `kinds` with one kind changed; the input is left untouched. */
export function withKind(
  kinds: RecordingKinds,
  kind: RecordingKind,
  value: boolean
): RecordingKinds {
  return { ...kinds, [kind]: value };
}
