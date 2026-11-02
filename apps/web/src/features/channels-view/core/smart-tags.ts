import type { ChannelEntity } from '@entity';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { ChannelLabelRule } from '@service-storage/generated/schemas/channelLabelRule';
import { canLabelChannel } from './channel-label-eligibility';

export function channelMatchesSmartTag(
  channel: ChannelEntity,
  rule: ChannelLabelRule,
  label?: Pick<ChannelLabel, 'teamId'>
): boolean {
  return (
    canLabelChannel(channel, label) &&
    rule.contains.length > 0 &&
    channel.name.toLowerCase().includes(rule.contains.toLowerCase())
  );
}

/** Preserve authorized server matches and reflect live names within each scope. */
export function resolveChannelLabelMemberships(
  labels: readonly ChannelLabel[],
  channels: readonly ChannelEntity[]
): ChannelLabel[] {
  const loadedIds = new Set(channels.map((channel) => channel.id));
  const channelsById = new Map(
    channels.map((channel) => [channel.id, channel])
  );
  return labels.map((label) => {
    const rule = label.rule;
    if (!rule) {
      const channelIds = label.channelIds.filter((id) => {
        const channel = channelsById.get(id);
        return !channel || canLabelChannel(channel, label);
      });
      return channelIds.length === label.channelIds.length
        ? label
        : {
            ...label,
            channelIds,
            channelCount:
              label.channelCount -
              (label.channelIds.length - channelIds.length),
          };
    }
    // Channel entities have no team ID. Shared-label matches must come from
    // the server so a matching name cannot add another team's channel.
    const serverIds = new Set(label.channelIds);
    const channelIds = [
      ...new Set([
        ...label.channelIds.filter((id) => !loadedIds.has(id)),
        ...channels
          .filter(
            (channel) =>
              (!label.teamId || serverIds.has(channel.id)) &&
              channelMatchesSmartTag(channel, rule, label)
          )
          .map((channel) => channel.id),
      ]),
    ];
    return { ...label, channelIds, channelCount: channelIds.length };
  });
}
