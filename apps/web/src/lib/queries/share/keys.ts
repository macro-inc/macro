import { createQueryKeys } from '@lukemorales/query-key-factory';

export const sharePermissionKeys = createQueryKeys('sharePermissions', {
  entity: (itemType: string, id: string) => ({
    queryKey: [itemType, id],
  }),
  channelNames: (channelIds: readonly string[]) => ({
    queryKey: [channelIds],
  }),
});
