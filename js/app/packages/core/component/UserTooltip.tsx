import { useSplitLayout } from '@app/component/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { isOk } from '@core/util/maybeResult';
import CommentIcon from '@icon/regular/chat-circle-text.svg';
import IconCheck from '@icon/regular/check.svg';
import IconCopy from '@icon/regular/copy.svg';
import Trash from '@phosphor-icons/core/regular/trash.svg?component-solid';
import { commsServiceClient } from '@service-comms/client';
import { useUserId } from '@service-gql/client';
import { Button } from '@ui/components/Button';
import { Match, Show, Switch } from 'solid-js';
import { ProfilePicture } from './ProfilePicture';

export type UserTooltipProps = {
  displayName: string;
  email?: string;
  id?: string;
  isDeleted?: boolean;
  copied: boolean;
  onCopyEmail: (e: MouseEvent) => void;
};

export function UserTooltip(props: UserTooltipProps) {
  const currentUserId = useUserId();
  const { replaceOrInsertSplit } = useSplitLayout();

  const openDM = async (e: PointerEvent | MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (props.id) {
      try {
        const result = await commsServiceClient.getOrCreateDirectMessage({
          recipient_id: props.id,
        });
        const channelId = isOk(result) && result[1]?.channel_id;
        if (channelId) {
          replaceOrInsertSplit({
            type: 'channel',
            id: channelId,
          });
        } else {
          toast.failure('Failed to open direct message');
        }
      } catch {
        toast.failure('Failed to open direct message');
      }
    }
  };

  return (
    <div class="bg-panel text-ink border border-edge-muted overflow-hidden">
      <div class="flex items-center gap-3 p-3">
        <div class="size-8 shrink-0 rounded-full bg-ink-extra-muted text-panel pointer-events-none">
          <Switch>
            <Match when={props.isDeleted}>
              <div class="size-8 shrink-0 rounded-full bg-ink-extra-muted/50 flex items-center justify-center">
                <Trash class="w-4 h-4 shrink-0" />
              </div>
            </Match>
            <Match when={props.id}>
              <ProfilePicture
                id={props.id}
                sizeClass={{
                  container: 'size-8',
                  icon: 'w-4 h-4',
                  text: 'text-lg leading-none',
                }}
              />
            </Match>
            <Match when={!props.id && props.email}>
              <ProfilePicture
                id={undefined}
                email={props.email}
                sizeClass={{
                  container: 'size-8',
                  icon: 'w-4 h-4',
                  text: 'text-lg leading-none',
                }}
              />
            </Match>
          </Switch>
        </div>

        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-ink truncate">
            {props.displayName}
          </div>
          <Show when={props.email && props.email !== props.displayName}>
            <div class="text-xs text-ink opacity-60 mt-0.5 truncate">
              {props.email}
            </div>
          </Show>
        </div>
      </div>

      <Show when={props.email || props.id}>
        <div class="border-t border-edge-muted"></div>
        <div class="p-2 flex flex-col gap-2">
          <Show when={props.email}>
            <Button
              onClick={props.onCopyEmail}
              class="text-xs text-ink-extramuted w-full justify-start"
            >
              {props.copied ? (
                <IconCheck class="w-3.5 h-3.5" />
              ) : (
                <IconCopy class="w-3.5 h-3.5" />
              )}
              Copy email
            </Button>
          </Show>
          <Show
            when={props.id && !props.isDeleted && props.id !== currentUserId()}
          >
            <Button
              onClick={openDM}
              class="text-xs text-ink-extramuted w-full justify-start"
            >
              <CommentIcon class="w-3.5 h-3.5" />
              DM
            </Button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
