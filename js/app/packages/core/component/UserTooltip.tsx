import { useSplitLayout } from '@app/component/split-layout/layout';
import { ClippedPanel } from '@core/component/ClippedPanel';
import { beveledCorners } from '../../block-theme/signals/themeSignals';
import { toast } from '@core/component/Toast/Toast';
import { isOk } from '@core/util/maybeResult';
import IconCheck from '@icon/regular/check.svg';
import WideCopy from '@macro-icons/wide/copy.svg';
import WideChat from '@macro-icons/wide/chat.svg';
import Trash from '@phosphor-icons/core/regular/trash.svg?component-solid';
import { commsServiceClient } from '@service-comms/client';
import { useUserId } from '@core/context/user';
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
  const { openWithSplit } = useSplitLayout();

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
          openWithSplit(
            { type: 'channel', id: channelId },
            { preferNewSplit: e.shiftKey }
          );
        } else {
          toast.failure('Failed to open direct message');
        }
      } catch {
        toast.failure('Failed to open direct message');
      }
    }
  };

  // TODO (seamus): add assign task button once launch popovet split with state is possible

  const buttonStyle =
    'px-3 text-xs w-full justify-start hover-transition-bg hover:bg-hover';

  return (
    <ClippedPanel tl={!beveledCorners()} active>
      <div class="bg-panel text-ink box-border border-accent overflow-hidden">
        <div class="flex items-center gap-2 p-2">
          <div class="size-10 shrink-0 rounded-full bg-ink-extra-muted pointer-events-none">
            <Switch>
              <Match when={props.isDeleted}>
                <div class="size-10 shrink-0 rounded-full bg-ink-extra-muted/50 flex items-center justify-center">
                  <Trash class="w-4 h-4 shrink-0" />
                </div>
              </Match>
              <Match when={props.id}>
                <ProfilePicture
                  id={props.id}
                  sizeClass={{
                    container: 'size-10',
                    icon: 'w-4 h-4',
                    text: 'text-lg text-panel leading-none',
                  }}
                />
              </Match>
              <Match when={!props.id && props.email}>
                <ProfilePicture
                  id={undefined}
                  email={props.email}
                  sizeClass={{
                    container: 'size-10',
                    icon: 'w-4 h-4',
                    text: 'text-lg text-panel leading-none',
                  }}
                />
              </Match>
            </Switch>
          </div>

          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">{props.displayName}</div>
            <Show when={props.email && props.email !== props.displayName}>
              <div class="text-xs opacity-60 truncate">{props.email}</div>
            </Show>
          </div>
        </div>

        <Show when={props.email || props.id}>
          <div class="border-t border-edge/20"></div>
          <div class="py-2 flex flex-col gap-0">
            <Show when={props.email}>
              <Button onClick={props.onCopyEmail} class={buttonStyle}>
                {props.copied ? (
                  <IconCheck class="w-3.5 h-3.5" />
                ) : (
                  <WideCopy class="w-3.5 h-3.5" />
                )}
                Copy email
              </Button>
            </Show>
            <Show
              when={
                props.id && !props.isDeleted && props.id !== currentUserId()
              }
            >
              <Button onClick={openDM} class={buttonStyle}>
                <WideChat class="w-3.5 h-3.5" />
                DM
              </Button>
            </Show>
          </div>
        </Show>
      </div>
    </ClippedPanel>
  );
}
