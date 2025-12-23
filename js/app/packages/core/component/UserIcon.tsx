import { IconButton } from '@core/component/IconButton';
import { toast } from '@core/component/Toast/Toast';
import { Tooltip } from '@core/component/Tooltip';
import { idToDisplayName, idToEmail } from '@core/user';
import { isOk } from '@core/util/maybeResult';
import IconCheck from '@icon/regular/check.svg';
import IconCopy from '@icon/regular/copy.svg';
import Trash from '@phosphor-icons/core/regular/trash.svg?component-solid';
import { commsServiceClient } from '@service-comms/client';
import { debounce } from '@solid-primitives/scheduled';
import { createMemo, createSignal, Match, Show, Switch } from 'solid-js';
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
  const email = createMemo(() => {
    if (!props.id) {
      return props.email;
    }
    return idToEmail(props.id);
  });

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

  const [copied, setCopied] = createSignal(false);

  const resetCopied = debounce(() => setCopied(false), 800);

  function handleCopyEmail() {
    const email_ = email();
    if (!email_) return;

    setCopied(true);
    navigator.clipboard.writeText(email_);
    toast.success('Email copied');
    resetCopied();
  }

  return (
    <Show when={displayName().length > 0 || email()} fallback={icon()}>
      <Tooltip
        tooltip={
          <div>
            <span class="text-xs">{displayName()}</span>
            <Show when={email()}>
              <span class="text-xs select-all flex items-center gap-1">
                {email()}

                <IconButton
                  icon={copied() ? IconCheck : IconCopy}
                  iconSize={16}
                  class="transition-all duration-300"
                  theme={copied() ? 'accent' : 'contrast'}
                  size="sm"
                  onDeepClick={handleCopyEmail}
                />
              </span>
            </Show>
          </div>
        }
        class={sizeClasses().container}
      >
        {icon()}
      </Tooltip>
    </Show>
  );
}
