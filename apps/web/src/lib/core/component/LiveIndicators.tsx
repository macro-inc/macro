import { SplitHeaderRight } from '@components/app/split-layout/components/SplitHeader';
import { ENABLE_LIVE_INDICATORS } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import type { EntityType } from '@service-connection/generated/schemas/entityType';
import { useEntityPresenceTracking } from '@service-connection/use-track-entity-presence';
import { AvatarGroup } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { useUserIndicators } from '../state/liveIndicators';
import { UserIcon } from './UserIcon';

const MAX_USER_INDICATORS = 3;

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

export function BlockLiveIndicators(props: {
  /** Defaults to the current block id. Pass an explicit id when that is not
   *  the tracked entity (agent sessions keep a placeholder block id). */
  entityId?: string;
}) {
  const indicators = useUserIndicators(
    'entityId' in props ? () => props.entityId : undefined
  );
  const userId = useUserId();

  return (
    <Show when={ENABLE_LIVE_INDICATORS}>
      <LiveIndicators userIds={indicators() ?? []} currentUserId={userId()} />
    </Show>
  );
}

/**
 * Header chrome for who is viewing this entity: publish presence and render
 * the avatar stack. Channels, documents, and agent sessions all use this.
 */
export function EntityTopBarLiveIndicators(props: {
  entityType: EntityType;
  entityId: () => string | undefined;
}) {
  useEntityPresenceTracking(props.entityType, props.entityId);

  return (
    <SplitHeaderRight>
      {/* Hidden on mobile/tablet: no floating-island treatment for live avatars yet. */}
      <div class="-order-1 touch:hidden" data-slot="live-indicators">
        <BlockLiveIndicators entityId={props.entityId()} />
      </div>
    </SplitHeaderRight>
  );
}
