import { ENABLE_LIVE_INDICATORS } from '@core/constant/featureFlags';
import { useUserId } from '@service-gql/client';
import { createMemo, For, Show } from 'solid-js';
import { useUserIndicators } from '../state/liveIndicators';
import { Tooltip } from './Tooltip';
import { UserIcon } from './UserIcon';

const MAX_USER_INDICATORS = 3;

export function UserIndicator(props: { userId: string }) {
  return (
    <Tooltip tooltip={props.userId?.split('|').at(1)?.split('@')[0]}>
      <div class="bg-panel size-6 rounded-full p-[2px] -mr-3">
        <UserIcon id={props.userId} isDeleted={false} size="fill" />
      </div>
    </Tooltip>
  );
}

export function LiveIndicators(props: {
  userIds: string[];
  currentUserId?: string;
}) {
  const userIds = () =>
    props.currentUserId
      ? props.userIds.filter((id) => id !== props.currentUserId)
      : props.userIds;

  const remaining = createMemo(() => {
    if (userIds().length < MAX_USER_INDICATORS) return undefined;
    return userIds().length - MAX_USER_INDICATORS;
  });
  const len = createMemo(() => userIds().length);

  return (
    <div
      class="flex items-center h-full shrink-0 overflow-hidden w-fit isolate"
      classList={{
        'pl-2 pr-4': len() > 0,
        'width-0': len() === 0,
      }}
    >
      <For each={userIds().splice(0, 3)}>
        {(userId) => <UserIndicator userId={userId} />}
      </For>
      <Show when={remaining()}>
        <div class="z-4">
          <Tooltip
            tooltip={userIds()
              .slice(MAX_USER_INDICATORS)
              .map((user) => user.split('|').at(1)?.split('@')[0])
              .join(', ')}
          >
            <div class="size-6 bg-menu border-2 text-[10px] -mr-3 border-panel rounded-full flex flex-col justify-center items-center">
              <span>{`+${remaining()}`}</span>
            </div>
          </Tooltip>
        </div>
      </Show>
    </div>
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
