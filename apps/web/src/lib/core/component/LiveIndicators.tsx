import { type BlockName, useBlockId, useBlockName } from '@core/block';
import { ENABLE_LIVE_INDICATORS } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { isTabFocused } from '@core/signal/tabFocus';
import { useEntityIndicators } from '@core/state/liveIndicators';
import { connectionGatewayClient } from '@service-connection/client';
import type { EntityType } from '@service-connection/generated/schemas/entityType';
import { AvatarGroup } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import { UserIcon } from './UserIcon';

const MAX_USER_INDICATORS = 3;

/** 20 seconds ping interval — matches connection_gateway stale threshold. */
const PING_INTERVAL = 20_000;

export function resolveEntityType(
  blockName: BlockName | undefined
): EntityType {
  switch (blockName) {
    case 'chat':
      return 'chat';
    case 'channel':
      return 'channel';
    case 'project':
      return 'project';
    case 'agent':
      return 'agent_session';
    default:
      return 'document';
  }
}

export function LiveIndicators(props: {
  userIds: string[];
  currentUserId?: string;
}) {
  const userIds = createMemo(() =>
    props.currentUserId
      ? props.userIds.filter((id) => id !== props.currentUserId)
      : props.userIds
  );

  const displayUserIds = () => userIds().slice(0, MAX_USER_INDICATORS);
  const remaining = createMemo(() =>
    Math.max(0, userIds().length - MAX_USER_INDICATORS)
  );

  return (
    <Show when={userIds().length > 0}>
      <AvatarGroup size="sm" class="pl-2 pr-1">
        <For each={displayUserIds()}>
          {(userId) => (
            <UserIcon id={userId} size="sm" showTooltip suppressClick />
          )}
        </For>

        <Show when={remaining()}>
          <AvatarGroup.Count size="sm">+{remaining()}</AvatarGroup.Count>
        </Show>
      </AvatarGroup>
    </Show>
  );
}

type EntityLiveIndicatorsProps = {
  /** Defaults to `resolveEntityType(useBlockName())`. */
  entityType?: EntityType;
  /** Defaults to `useBlockId()`. When undefined, tracking is paused. */
  entityId?: Accessor<string | undefined>;
  /**
   * When false, only renders the avatar stack — something else (usually
   * `BlockContainer`) owns open/ping/close.
   */
  track?: boolean;
};

/**
 * Live viewer avatars for an entity. Tracks presence via the connection
 * gateway when `track` is true (default), and renders whoever else is
 * looking at the same entity.
 */
export function EntityLiveIndicators(props?: EntityLiveIndicatorsProps) {
  const blockId = useBlockId();
  const blockName = useBlockName();
  const userId = useUserId();

  const entityType = () => props?.entityType ?? resolveEntityType(blockName);
  const entityId = () => props?.entityId?.() ?? blockId;
  const shouldTrack = () => props?.track !== false;

  createEffect(() => {
    if (!shouldTrack() || !ENABLE_LIVE_INDICATORS) return;

    const id = entityId();
    if (!id) return;

    const type = entityType();

    connectionGatewayClient.trackEntity({
      entity_type: type,
      entity_id: id,
      action: 'open',
    });

    const pingInterval = setInterval(() => {
      if (isTabFocused()) {
        connectionGatewayClient.trackEntity({
          entity_type: type,
          entity_id: id,
          action: 'ping',
        });
      }
    }, PING_INTERVAL);

    onCleanup(() => {
      clearInterval(pingInterval);
      connectionGatewayClient.trackEntity({
        entity_type: type,
        entity_id: id,
        action: 'close',
      });
    });
  });

  const userIds = useEntityIndicators(entityId);

  return (
    <Show when={ENABLE_LIVE_INDICATORS}>
      <LiveIndicators userIds={userIds()} currentUserId={userId()} />
    </Show>
  );
}

/** Display-only live indicators for blocks whose tracking lives in `BlockContainer`. */
export function BlockLiveIndicators() {
  return <EntityLiveIndicators track={false} />;
}
