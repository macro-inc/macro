import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { ChannelLabelScopeSelection } from '@service-storage/generated/schemas/channelLabelScopeSelection';

export const channelLabelKeys = createQueryKeys('channel-labels', {
  list: (scope?: ChannelLabelScopeSelection, actorId?: string) => [
    scope ?? 'default',
    actorId ?? 'signed-out',
  ],
  preview: (
    pattern: string,
    scope?: ChannelLabelScopeSelection,
    actorId?: string
  ) => [scope ?? 'default', pattern, actorId ?? 'signed-out'],
});
