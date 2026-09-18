import type { ChannelEntity } from '@entity';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { ChannelLabelRule } from '@service-storage/generated/schemas/channelLabelRule';

export function channelMatchesSmartTag(
  channel: ChannelEntity,
  rule: ChannelLabelRule
): boolean {
  return (
    channel.channelType !== 'direct_message' &&
    rule.contains.length > 0 &&
    channel.name.toLowerCase().includes(rule.contains.toLowerCase())
  );
}

/** Keep server matches beyond loaded pages, while reflecting live channel-name updates. */
export function resolveSmartTagMemberships(
  labels: readonly ChannelLabel[],
  channels: readonly ChannelEntity[]
): ChannelLabel[] {
  const loadedIds = new Set(channels.map((channel) => channel.id));
  return labels.map((label) => {
    const rule = label.rule;
    if (!rule) return label;
    const channelIds = [
      ...new Set([
        ...label.channelIds.filter((id) => !loadedIds.has(id)),
        ...channels
          .filter((channel) => channelMatchesSmartTag(channel, rule))
          .map((channel) => channel.id),
      ]),
    ];
    return { ...label, channelIds, channelCount: channelIds.length };
  });
}
