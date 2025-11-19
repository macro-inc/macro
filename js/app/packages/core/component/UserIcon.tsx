import { Tooltip } from '@core/component/Tooltip';
import { idToDisplayName } from '@core/user';
import { isOk } from '@core/util/maybeResult';
import Trash from '@phosphor-icons/core/regular/trash.svg?component-solid';
import { commsServiceClient } from '@service-comms/client';
import { createMemo, Match, Switch } from 'solid-js';
import { useSplitLayout } from '../../app/component/split-layout/layout';
import { ProfilePicture } from './ProfilePicture';

export type UserIconProps = {
  isDeleted?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'fill';
  suppressClick?: boolean;
  // TODO: remove imageUrl. not actively used.
  imageURL?: string;
  fetchUrl?: boolean;
} & ({ id: string; email?: never } | { email: string; id?: never });

export type SizeClass = {
  container: string;
  icon: string;
  text: string;
};

export function UserIcon(props: UserIconProps) {
  const displayName = createMemo(() => idToDisplayName(props.id!));

  const sizeClasses = createMemo(() => {
    switch (props.size || 'md') {
      case 'xs':
        return {
          container: 'size-4',
          icon: 'w-2 h-2',
          text: 'text-[8px] leading-none',
        };
      case 'sm':
        return {
          container: 'size-6',
          icon: 'w-3 h-3',
          text: 'text-xs leading-none',
        };
      case 'md':
        return {
          container: 'size-8',
          icon: 'w-4 h-4',
          text: 'text-lg leading-none',
        };
      case 'lg':
        return {
          container: 'size-10',
          icon: 'w-5 h-5',
          text: 'text-lg leading-none',
        };
      case 'xl':
        return {
          container: 'size-25',
          icon: 'w-16 h-16',
          text: 'text-[48px] leading-none',
        };
      case 'fill':
        return {
          container: 'w-full h-full',
          icon: 'w-full h-full',
          text: 'text-[min(85%,3rem)] leading-none',
        };
    }
  });

  const { replaceOrInsertSplit } = useSplitLayout();

  const getOrCreateDm = async () => {
    if (props.id) {
      const result = await commsServiceClient.getOrCreateDirectMessage({
        recipient_id: props.id,
      });
      const channelId = isOk(result) && result[1]?.channel_id;
      if (channelId) {
        replaceOrInsertSplit({
          type: 'channel',
          id: channelId,
        });
      }
    }
  };

  const icon = createMemo(() => (
    <div
      onMouseDown={props.suppressClick ? undefined : getOrCreateDm}
      class={`${sizeClasses().container} shrink-0 rounded-full bg-ink-extra-muted text-panel`}
    >
      <Switch>
        <Match when={props.isDeleted}>
          <div
            class={`${sizeClasses().container} shrink-0 rounded-full bg-ink-extra-muted/50 items-center`}
          >
            <Trash class={`${sizeClasses().icon} shrink-0`} />
          </div>
        </Match>
        <Match when={props.id}>
          <ProfilePicture id={props.id} sizeClass={sizeClasses()} />
        </Match>
        <Match when={!props.id && props.email}>
          <ProfilePicture
            id={undefined}
            email={props.email}
            sizeClass={sizeClasses()}
          />
        </Match>
      </Switch>
    </div>
  ));

  const tooltipContent = createMemo(() => (
    <span class="text-xs">{displayName()}</span>
  ));

  if (displayName().length > 0) {
    return (
      <Tooltip tooltip={tooltipContent()} class={sizeClasses().container}>
        {icon()}
      </Tooltip>
    );
  } else {
    return icon();
  }
}
