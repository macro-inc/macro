import {
  EntityIcon,
  type EntityIconSelector,
  getPreviewItemIconType,
} from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import {
  muteItemFallbackIconType,
  muteItemPreviewEntity,
  normalizeMuteItemType,
} from '@entity/utils/notification';
import { mutedEntityTypeLabel } from '@notifications/notification-event-catalog';
import {
  type ItemEntity,
  isAccessiblePreviewItem,
  useItemPreview,
} from '@queries/preview';
import type { UserUnsubscribe } from '@service-notification/generated/schemas/userUnsubscribe';
import { ChannelType } from '@service-storage/generated/schemas/channelType';
import { createMemo, Show } from 'solid-js';

/**
 * One muted entity in Settings: icon + name, never the raw id.
 */
export function MutedItemRow(props: {
  item: UserUnsubscribe;
  onUnmute: () => void;
}) {
  const entity = createMemo(() => muteItemPreviewEntity(props.item));
  return (
    <Show
      when={entity()}
      fallback={
        <MutedItemLayout
          item={props.item}
          name={mutedEntityTypeLabel(props.item.item_type)}
          iconType={muteItemFallbackIconType(props.item.item_type)}
          onUnmute={props.onUnmute}
        />
      }
    >
      {(previewEntity) => (
        <MutedItemPreviewRow
          item={props.item}
          entity={previewEntity()}
          onUnmute={props.onUnmute}
        />
      )}
    </Show>
  );
}

function MutedItemPreviewRow(props: {
  item: UserUnsubscribe;
  entity: ItemEntity;
  onUnmute: () => void;
}) {
  const [preview] = useItemPreview(() => props.entity);
  const name = () => {
    const item = preview();
    if (isAccessiblePreviewItem(item) && item.name.trim()) return item.name;
    return mutedEntityTypeLabel(props.item.item_type);
  };
  const iconType = (): EntityIconSelector => {
    const item = preview();
    if (isAccessiblePreviewItem(item)) {
      const fromPreview = getPreviewItemIconType(item);
      if (fromPreview !== 'default') return fromPreview;
    }
    return muteItemFallbackIconType(props.item.item_type);
  };

  return (
    <MutedItemLayout
      item={props.item}
      name={name()}
      iconType={iconType()}
      onUnmute={props.onUnmute}
    />
  );
}

function MutedItemLayout(props: {
  item: UserUnsubscribe;
  name: string;
  iconType: EntityIconSelector;
  onUnmute: () => void;
}) {
  const dmRecipientId = useMutedChannelDmRecipientId(() => props.item);

  return (
    <div class="flex items-center gap-3 px-6 py-3.5 min-h-[60px]">
      <div class="size-5 shrink-0 flex items-center justify-center">
        <Show
          when={dmRecipientId()}
          fallback={
            <EntityIcon targetType={props.iconType} size="sm" class="size-4" />
          }
        >
          {(recipientId) => (
            <UserIcon
              id={recipientId()}
              size="sm"
              suppressClick
              showTooltip={false}
            />
          )}
        </Show>
      </div>
      <div class="min-w-0 flex-1 truncate text-sm text-ink">{props.name}</div>
      <button
        type="button"
        class="shrink-0 text-sm text-ink-muted hover:text-ink"
        onClick={props.onUnmute}
      >
        Unmute
      </button>
    </div>
  );
}

function useMutedChannelDmRecipientId(
  item: () => UserUnsubscribe
): () => string | undefined {
  const isChannel = () => normalizeMuteItemType(item().item_type) === 'channel';
  const ctx = useChannelsContext();
  const userId = useUserId();
  return createMemo(() => {
    if (!isChannel()) return undefined;
    const channel = ctx.channelsById()[item().item_id];
    if (channel?.channel_type !== ChannelType.direct_message) {
      return undefined;
    }
    const recipient =
      channel.participants.find((p) => p.user_id !== userId()) ??
      channel.participants[0];
    return recipient?.user_id;
  });
}
