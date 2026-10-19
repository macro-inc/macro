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
import { err, ok } from 'neverthrow';
import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';
import type { ShareDeliveryContext } from './context/share-delivery-context';
import type { ShareEvent } from './core/delivery-plan';
import {
  type ChannelAccessLevel,
  parseChannelAccessLevel,
  type ShareFormat,
  type ShareItem,
  type ShareItemRef,
  type ShareKind,
} from './core/share-item';
import {
  createShareForm,
  type ShareForm,
  type ShareLocation,
} from './primitives/create-share-form';
import { changeChannelAccess } from './queries/channel-access';

export type {
  ChannelAccessLevel,
  RestrictedKind,
  ShareItem,
  ShareKind,
} from './core/share-item';
export { isSendRestricted, parseChannelAccessLevel } from './core/share-item';
export type {
  ShareForm,
  ShareLocation,
  ShareSubmitResult,
} from './primitives/create-share-form';
export { changeChannelAccess } from './queries/channel-access';

export type RecipientOption = WithCustomUserInput<
  'user' | 'contact' | 'channel'
>;

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
    format: input.block === undefined ? 'other' : formatOf(input.block),
    canGrant: input.canGrant,
    channelGrants: new Map(grants),
  };
}

function formatOf(block: BlockName | BlockAlias): ShareFormat {
  return match(resolveBlockAlias(block))
    .returnType<ShareFormat>()
    .with('md', () => 'markdown')
    .with('pdf', () => 'pdf')
    .otherwise(() => 'other');
}

export function useShareForm(
  items: Accessor<readonly ShareItem[]>,
  options: { readonly location: ShareLocation }
): ShareForm<RecipientOption> {
  return createShareForm<RecipientOption>(
    {
      items,
      location: options.location,
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
    resolvePeopleChannel: async (userIds, span) => {
      const channelId = await resolvePeopleChannel(userIds, span);
      return channelId === undefined ? err({ kind: 'failed' }) : ok(channelId);
    },
    send: async ({ channelId, messageId, items: attached, text }, span) => {
      const sent = await sendToChannel({
        channelId,
        content: text,
        mentions: [],
        attachments: attached.map(toAttachment),
        messageId,
        trace: span,
      });
      return sent
        ? ok({ open: sent.navigateToChannel })
        : err({ kind: 'failed' });
    },
    // The active span does not survive an `await`; a grant's request starts
    // before its first one.
    changeChannelAccess: (item, change, span) =>
      span.run(() => changeChannelAccess(item, change)),
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
    // Attachments name a pull request `foreign_entity`, unlike its item type.
    entity_type:
      item.kind === 'foreign'
        ? 'foreign_entity'
        : itemTypeToReferenceEntityType(item.kind),
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
