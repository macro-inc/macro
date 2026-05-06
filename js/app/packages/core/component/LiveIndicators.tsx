import { ENABLE_LIVE_INDICATORS } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { createMemo, For, Show } from 'solid-js';
import { useUserIndicators } from '../state/liveIndicators';
import { UserIcon } from './UserIcon';
import { AvatarGroup } from '@ui';

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

export function BlockLiveIndicators() {
  const indicators = useUserIndicators();
  const userId = useUserId();

  return (
    <Show when={ENABLE_LIVE_INDICATORS}>
      <LiveIndicators userIds={indicators() ?? []} currentUserId={userId()} />
    </Show>
  );
}
