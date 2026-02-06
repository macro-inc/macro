import { createMemo, For, Show } from 'solid-js';
import { UserIcon } from './UserIcon';
import { cn } from '@ui/utils/classname';
import { match } from 'ts-pattern';

export type UserGroupProps = {
  userIds: string[];
  maxUsers?: number;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  suppressClick?: boolean;
  showTooltip?: boolean;
};

/**
 * Displays a group of user avatars in an overlapping style with an overflow indicator
 */
export function UserGroup(props: UserGroupProps) {
  const max = () => props.maxUsers ?? 3;
  const size = () => props.size ?? 'xs';

  const remaining = createMemo(() => {
    if (props.userIds.length <= max()) return undefined;
    return props.userIds.length - max();
  });

  const displayUserIds = () => props.userIds.slice(0, max());

  const sizeClasses = () => {
    return match(size())
      .with('xs', () => ({
        userIcon: 'size-4',
        wrapper: 'p-[2px]',
        overlap: '-mr-3',
        counter: 'size-5 text-[10px] -mr-2 border-2',
      }))
      .with('sm', () => ({
        userIcon: 'size-6',
        wrapper: 'p-[2px]',
        overlap: '-mr-4',
        counter: 'size-6 text-xs -mr-3 border-2',
      }))
      .with('md', () => ({
        userIcon: 'size-8',
        wrapper: 'p-[3px]',
        overlap: '-mr-5',
        counter: 'size-8 text-sm -mr-4 border-2',
      }))
      .with('lg', () => ({
        userIcon: 'size-10',
        wrapper: 'p-[3px]',
        overlap: '-mr-6',
        counter: 'size-10 text-base -mr-5 border-2',
      }))
      .with('xl', () => ({
        userIcon: 'size-25',
        wrapper: 'p-1',
        overlap: '-mr-16',
        counter: 'size-20 text-2xl -mr-12 border-4',
      }))
      .exhaustive();
  };

  return (
    <div class="flex items-center shrink-0 w-fit pr-3">
      <For each={displayUserIds()}>
        {(userId) => (
          <div
            class={cn(
              'bg-panel rounded-full',
              sizeClasses().wrapper,
              sizeClasses().overlap
            )}
          >
            <UserIcon
              id={userId}
              isDeleted={false}
              size={size()}
              suppressClick={props.suppressClick}
              showTooltip={props.showTooltip ?? false}
            />
          </div>
        )}
      </For>
      <Show when={remaining()}>
        <div class="z-4">
          <div
            class={cn(
              'bg-menu text-ink border-panel rounded-full flex flex-col justify-center items-center',
              sizeClasses().counter
            )}
          >
            <span>+{remaining()}</span>
          </div>
        </div>
      </Show>
    </div>
  );
}
