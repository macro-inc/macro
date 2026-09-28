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
import { formatSnoozeDeadline } from '@notifications/core/snooze';
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
  onSnooze?: () => void;
  pending?: boolean;
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
          onSnooze={props.onSnooze}
          pending={props.pending}
        />
      }
    >
      {(previewEntity) => (
        <MutedItemPreviewRow
          item={props.item}
          entity={previewEntity()}
          onUnmute={props.onUnmute}
          onSnooze={props.onSnooze}
          pending={props.pending}
        />
      )}
    </Show>
  );
}

function MutedItemPreviewRow(props: {
  item: UserUnsubscribe;
  entity: ItemEntity;
  onUnmute: () => void;
  onSnooze?: () => void;
  pending?: boolean;
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
      onSnooze={props.onSnooze}
      pending={props.pending}
    />
  );
}

function MutedItemLayout(props: {
  item: UserUnsubscribe;
  name: string;
  iconType: EntityIconSelector;
  onUnmute: () => void;
  onSnooze?: () => void;
  pending?: boolean;
}) {
  const dmRecipientId = useMutedChannelDmRecipientId(() => props.item);

  return (
    <div class="flex items-center gap-3 px-6 py-3.5 min-h-[60px] mobile:grid mobile:grid-cols-[1.25rem_minmax(0,1fr)] mobile:gap-y-1 mobile:px-4">
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
      <div class="min-w-0 flex-1 text-sm text-ink">
        <div class="truncate" title={props.name}>
          {props.name}
        </div>
        <Show when={props.item.snoozed_until}>
          {(until) => (
            <div class="text-xs text-ink-muted">
              Until {formatSnoozeDeadline(until())}
            </div>
          )}
        </Show>
      </div>
      <div class="flex shrink-0 items-center gap-3 mobile:col-start-2 mobile:gap-2">
        <Show when={props.onSnooze}>
          <button
            type="button"
            class="shrink-0 text-sm text-ink-muted hover:text-ink disabled:opacity-50 mobile:min-h-11 mobile:rounded-full mobile:bg-ink/5 mobile:px-3"
            disabled={props.pending}
            onClick={props.onSnooze}
          >
            {props.item.snoozed_until ? 'Change time' : 'Snooze instead'}
          </button>
        </Show>
        <button
          type="button"
          class="shrink-0 text-sm text-ink-muted hover:text-ink disabled:opacity-50 mobile:min-h-11 mobile:rounded-full mobile:bg-ink/5 mobile:px-3"
          onClick={props.onUnmute}
          disabled={props.pending}
        >
          {props.item.snoozed_until ? 'Resume' : 'Unmute'}
        </button>
      </div>
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
