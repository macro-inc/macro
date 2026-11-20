import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { ChannelLabelScopeSelection } from '@service-storage/generated/schemas/channelLabelScopeSelection';

const definitions = {
  list: (
    scope?: ChannelLabelScopeSelection,
    actorId?: string
  ): [string, string] => [scope ?? 'default', actorId ?? 'signed-out'],
  preview: (
    pattern: string,
    scope?: ChannelLabelScopeSelection,
    actorId?: string
  ): [string, string, string] => [
    scope ?? 'default',
    pattern,
    actorId ?? 'signed-out',
  ],
};

export const channelLabelKeys = createQueryKeys('channel-labels', definitions);
export const channelSectionKeys = createQueryKeys(
  'channel-sections',
  definitions
);
