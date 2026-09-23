import type { ChannelEntity } from '@entity';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { ChannelLabelRule } from '@service-storage/generated/schemas/channelLabelRule';
import { canLabelChannel } from './channel-label-eligibility';

export function channelMatchesSmartTag(
  channel: ChannelEntity,
  rule: ChannelLabelRule
): boolean {
  return (
    canLabelChannel(channel) &&
    rule.contains.length > 0 &&
    channel.name.toLowerCase().includes(rule.contains.toLowerCase())
  );
}

/** Keep unloaded server matches, exclude non-team channels, and reflect live names. */
export function resolveChannelLabelMemberships(
  labels: readonly ChannelLabel[],
  channels: readonly ChannelEntity[]
): ChannelLabel[] {
  const loadedIds = new Set(channels.map((channel) => channel.id));
  const ineligibleIds = new Set(
    channels
      .filter((channel) => !canLabelChannel(channel))
      .map((channel) => channel.id)
  );
  return labels.map((label) => {
    const rule = label.rule;
    if (!rule) {
      const channelIds = label.channelIds.filter(
        (id) => !ineligibleIds.has(id)
      );
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
              channelMatchesSmartTag(channel, rule)
          )
          .map((channel) => channel.id),
      ]),
    ];
    return { ...label, channelIds, channelCount: channelIds.length };
  });
}
