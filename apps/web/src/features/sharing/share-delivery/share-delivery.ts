import { useAnalytics } from '@app/lib/analytics/analytics-context';
import type { BlockAlias, BlockName } from '@core/block';
import { resolveBlockAlias } from '@core/constant/allBlocks';
import { ENABLE_MARKDOWN_COMMENTS } from '@core/constant/featureFlags';
import type { WithCustomUserInput } from '@core/user';
import { useSendMessageToPeople } from '@core/util/channels';
import { newMessageId } from '@queries/messages/mutations';
import type { NewAttachment } from '@service-storage/generated/schemas/newAttachment';
import type { SharePermissionV2ChannelSharePermissions } from '@service-storage/generated/schemas/sharePermissionV2ChannelSharePermissions';
import { itemTypeToReferenceEntityType } from '@service-storage/itemType';
import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';
import type { ShareDeliveryContext } from './context/share-delivery-context';
import type { ShareEvent } from './core/delivery-plan';
import {
  type ChannelAccessLevel,
  parseChannelAccessLevel,
  type ShareItem,
  type ShareItemRef,
  type ShareKind,
} from './core/share-item';
import {
  createShareForm,
  type ShareForm,
} from './primitives/create-share-form';
import { changeChannelAccess } from './queries/channel-access';

export type {
  ChannelAccessLevel,
  OwnerOnlyKind,
  ShareItem,
  ShareKind,
} from './core/share-item';
export { isOwnerOnlyToSend, parseChannelAccessLevel } from './core/share-item';
export type {
  ShareForm,
  ShareSubmitResult,
} from './primitives/create-share-form';
export { changeChannelAccess } from './queries/channel-access';

export type RecipientOption = WithCustomUserInput<
  'user' | 'contact' | 'channel'
>;

export type ShareLocation = 'forward_to_channel' | 'bulk_share';

export type ShareItemInput = {
  readonly id: string;
  readonly kind: ShareKind;
  readonly name: string;
  readonly block?: BlockName | BlockAlias;
  readonly canGrant: boolean;
  readonly channelGrants?: SharePermissionV2ChannelSharePermissions;
};

export function toShareItem(input: ShareItemInput): ShareItem {
  const grants = (input.channelGrants ?? []).flatMap(
    ({ channel_id, access_level }): [string, ChannelAccessLevel][] => {
      const level = parseChannelAccessLevel(access_level);
      return level ? [[channel_id, level]] : [];
    }
  );
  return {
    kind: input.kind,
    id: input.id,
    name: input.name,
    markdown:
      input.block !== undefined && resolveBlockAlias(input.block) === 'md',
    canGrant: input.canGrant,
    channelGrants: new Map(grants),
  };
}

export function useShareForm(
  items: Accessor<readonly ShareItem[]>,
  options: { readonly location: ShareLocation }
): ShareForm<RecipientOption> {
  return createShareForm<RecipientOption>(
    {
      items,
      markdownComments: ENABLE_MARKDOWN_COMMENTS,
      mintMessageId: newMessageId,
    },
    useAppShareDeliveryContext(items, options.location)
  );
}

function useAppShareDeliveryContext(
  items: Accessor<readonly ShareItem[]>,
  location: ShareLocation
): ShareDeliveryContext {
  const { resolvePeopleChannel, sendToChannel } = useSendMessageToPeople();
  const analytics = useAnalytics();

  return {
    resolvePeopleChannel,
    send: async ({ channelId, messageId, items: attached, text }) => {
      const sent = await sendToChannel({
        channelId,
        content: text,
        mentions: [],
        attachments: attached.map(toAttachment),
        messageId,
      });
      return sent && { open: sent.navigateToChannel };
    },
    changeChannelAccess,
    track: (event) =>
      analytics.track('share_entity', {
        ...toSharePayload(event),
        location,
        ...(location === 'bulk_share' && { bulkCount: items().length }),
      }),
  };
}

function toAttachment(item: ShareItemRef): NewAttachment {
  return {
    entity_type: itemTypeToReferenceEntityType(item.kind),
    entity_id: item.id,
  };
}

function toSharePayload(event: ShareEvent) {
  return match(event)
    .with({ t: 'forwarded' }, ({ item, target }) => ({
      entityType: item.kind,
      entityId: item.id,
      shareMethod: 'forward' as const,
      targetType: target,
    }))
    .with({ t: 'access-set' }, ({ item, level }) => ({
      entityType: item.kind,
      entityId: item.id,
      shareMethod: 'channel' as const,
      accessLevel: level,
    }))
    .exhaustive();
}
