import type {
  AccessLevel,
  UpdateChannelSharePermission,
  UpdateSharePermissionRequestV2,
} from '../../../generated/storage/types.gen';
import type { Channel } from '../channels/channel';

/** Sharing updates reference channels by handle. Null clears the corresponding grant collection. */
export type SharePermissionOptions = Omit<
  UpdateSharePermissionRequestV2,
  'channelSharePermissions'
> & {
  /** Channel grants to create or replace. */
  channelSharePermissions?:
    | {
        channel: Channel;
        accessLevel?: AccessLevel;
        operation: UpdateChannelSharePermission['operation'];
      }[]
    | null;
};

/** Convert sharing options into the generated backend contract. */
export function sharePermissionBody(
  options: SharePermissionOptions,
): UpdateSharePermissionRequestV2 {
  return {
    ...options,
    channelSharePermissions:
      options.channelSharePermissions === undefined ||
      options.channelSharePermissions === null
        ? options.channelSharePermissions
        : options.channelSharePermissions.map((g) => ({
            channelId: g.channel.id,
            accessLevel: g.accessLevel,
            operation: g.operation,
          })),
  };
}
