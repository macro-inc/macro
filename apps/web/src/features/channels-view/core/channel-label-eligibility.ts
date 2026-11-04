import type { ChannelEntity } from '@entity';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { ChannelSectionKey } from '../types';

/** Personal sections accept named conversations; shared sections stay team-only. */
export function canLabelChannel(
  channel: Pick<ChannelEntity, 'channelType'> | undefined,
  label?: Pick<ChannelLabel, 'teamId'>
): boolean {
  if (label?.teamId) return channel?.channelType === 'team';
  return (
    channel?.channelType === 'team' ||
    channel?.channelType === 'public' ||
    channel?.channelType === 'private'
  );
}

/** Writes require a known matching team, unlike server-authorized membership display. */
export function canAssignChannel(
  channel: Pick<ChannelEntity, 'channelType' | 'teamId'> | undefined,
  label?: Pick<ChannelLabel, 'teamId'>
): boolean {
  return (
    canLabelChannel(channel, label) &&
    (!label?.teamId || channel?.teamId === label.teamId)
  );
}

/** Preserve authorized server memberships until the channel metadata arrives. */
export function filterChannelLabelMembers(
  channelIds: readonly string[],
  channelsById: ReadonlyMap<
    string,
    Pick<ChannelEntity, 'channelType' | 'teamId'>
  >,
  label?: Pick<ChannelLabel, 'teamId'>
): string[] {
  return channelIds.filter((id) => {
    const channel = channelsById.get(id);
    return channel === undefined || canLabelChannel(channel, label);
  });
}

/** Scope changes keep every member; unavailable channels cannot be silently dropped. */
export function channelSectionScopeChangeError(
  label: Pick<ChannelLabel, 'channelIds' | 'channelCount'>,
  channelsById: ReadonlyMap<
    string,
    Pick<ChannelEntity, 'channelType' | 'teamId' | 'isParticipant'>
  >,
  target: Pick<ChannelLabel, 'teamId'>
): 'unavailable' | 'team-only' | undefined {
  if (new Set(label.channelIds).size !== label.channelCount) {
    return 'unavailable';
  }

  for (const id of label.channelIds) {
    const channel = channelsById.get(id);
    if (!channel || channel.isParticipant === false) {
      return 'unavailable';
    }

    if (!canAssignChannel(channel, target)) {
      return target.teamId ? 'team-only' : 'unavailable';
    }
  }
}

/** Explain blocked section drops with the same membership rules as the picker. */
export function channelSectionDropError(options: {
  section: ChannelSectionKey;
  label?: Pick<ChannelLabel, 'id' | 'teamId' | 'rule' | 'channelIds'>;
  channel?: Pick<ChannelEntity, 'id' | 'channelType' | 'teamId'>;
  sourceLabelId?: string;
}): 'unsupported' | 'smart' | 'team-only' | 'already-present' | undefined {
  const { section, label, channel, sourceLabelId } = options;

  if (label?.rule) {
    return 'smart';
  }

  if (!channel || !canAssignChannel(channel, label)) {
    return label?.teamId ? 'team-only' : 'unsupported';
  }

  if (label) {
    if (label.id === sourceLabelId || label.channelIds.includes(channel.id)) {
      return 'already-present';
    }

    return;
  }

  if (section === 'team_channels' && channel?.channelType !== 'team') {
    return 'team-only';
  }

  if (section === 'channels' && channel?.channelType === 'team') {
    return 'unsupported';
  }

  if (section !== 'team_channels' && section !== 'channels') {
    return 'unsupported';
  }

  if (!sourceLabelId) {
    return 'already-present';
  }
}
