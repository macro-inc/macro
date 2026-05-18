import { useSplitLayout } from '@app/component/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { isOk } from '@core/util/maybeResult';
import WideChat from '@icon/wide-chat.svg';
import WideCopy from '@icon/wide-copy.svg';
import WideTask from '@icon/wide-task.svg';
import IconCheck from '@phosphor/check.svg';
import { commsServiceClient } from '@service-comms/client';
import { debounce } from '@solid-primitives/scheduled';
import { Button, Surface } from '@ui';
import { createSignal, Show } from 'solid-js';
import { UserIcon } from './UserIcon';

export type UserTooltipProps = {
  displayName: string;
  email?: string;
  id?: string;
  isDeleted?: boolean;
  onClose?: () => void;
};

export function UserTooltip(props: UserTooltipProps) {
  const [copied, setCopied] = createSignal(false);
  const resetCopied = debounce(() => setCopied(false), 800);

  function handleCopyEmail(e: MouseEvent) {
    e.stopPropagation();
    const email = props.email;
    if (!email) return;
    setCopied(true);
    navigator.clipboard.writeText(email);
    toast.success('Email copied');
    resetCopied();
    props.onClose?.();
  }
  const currentUserId = useUserId();
  const { openWithSplit, popoverSplit } = useSplitLayout();

  const openDM = async (e: PointerEvent | MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    props.onClose?.();
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

  const openTaskComposer = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    props.onClose?.();
    if (props.id) {
      popoverSplit({
        type: 'component',
        id: 'task-compose',
        params: { initialAssigneeIds: [props.id] },
      });
    }
  };

  const buttonStyle =
    'px-3 text-xs w-full justify-start hover:bg-hover rounded-xs';

  // Determine avatar props based on what we have
  const avatarProps = () => {
    if (props.id) {
      return { id: props.id } as const;
    }
    if (props.email) {
      return { email: props.email } as const;
    }
    // Fallback - use email even if empty to satisfy the union type
    return { email: '?' } as const;
  };

  return (
    <Surface depth={2} active>
      <div class="text-ink max-w-lg">
        <div class="flex items-center gap-2 p-2">
          <UserIcon
            {...avatarProps()}
            size="lg"
            isDeleted={props.isDeleted}
            showTooltip={false}
            suppressClick
            class="pointer-events-none"
          />

          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">{props.displayName}</div>
            <Show when={props.email && props.email !== props.displayName}>
              <div class="text-xs opacity-60 truncate">{props.email}</div>
            </Show>
          </div>
        </div>

        <Show when={props.email || props.id}>
          <div class="border-t border-edge"></div>
          <div class="p-2 flex flex-col gap-0">
            <Show when={props.email}>
              <Button onClick={handleCopyEmail} class={buttonStyle}>
                {copied() ? (
                  <IconCheck class="size-3.5" />
                ) : (
                  <WideCopy class="size-3.5" />
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
                <WideChat class="size-3.5" />
                DM
              </Button>
            </Show>
            <Show when={props.id && !props.isDeleted}>
              <Button onClick={openTaskComposer} class={buttonStyle}>
                <WideTask class="size-3.5" />
                Assign task
              </Button>
            </Show>
          </div>
        </Show>
      </div>
    </Surface>
  );
}
