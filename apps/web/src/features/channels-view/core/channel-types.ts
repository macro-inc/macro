import type { Query } from '@app/features/next-soup/filters/filter-store';
import { ChannelType } from '@service-storage/generated/schemas/channelType';

/** The channel types a channel list's filters let it show. */
export function channelTypesShownBy(filters: Query): string[] {
  const included = filters.include?.channelType ?? Object.values(ChannelType);
  const excluded = filters.exclude?.channelType ?? [];
  return included.filter((type) => !excluded.includes(type));
}
