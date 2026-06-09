import { useSplitLayout } from '@app/component/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { useIsInboxOnlyLinkedChild } from '@core/user';
import WideChat from '@icon/wide-chat.svg';
import WideCopy from '@icon/wide-copy.svg';
import WideTask from '@icon/wide-task.svg';
import IconCheck from '@phosphor/check.svg';
import { useGetOrCreateDirectMessageMutation } from '@queries/channel/get-or-create-dm';
import { debounce } from '@solid-primitives/scheduled';
import { cn, Surface } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';
import { UserIcon } from './UserIcon';

type UserTooltipProps = {
  displayName: string;
  email?: string;
  id?: string;
  isDeleted?: boolean;
  onClose?: () => void;
  photoUrl?: string;
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
  const isInboxOnlyLinkedChild = useIsInboxOnlyLinkedChild();
  const canTreatAsUser = () =>
    !!props.id && !props.isDeleted && !isInboxOnlyLinkedChild(props.id);
  const { openWithSplit, popoverSplit } = useSplitLayout();
  const getOrCreateDmMutation = useGetOrCreateDirectMessageMutation({
    onError: () => toast.failure('Failed to open direct message'),
  });

  const openDM = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!props.id) return;
    const preferNewSplit = e.shiftKey;
    try {
      const { channel_id } = await getOrCreateDmMutation.mutateAsync({
        recipient_id: props.id,
      });
      openWithSplit({ type: 'channel', id: channel_id }, { preferNewSplit });
    } catch {
      // The mutation's onError callback handles the toast.
    } finally {
      props.onClose?.();
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

  // Determine avatar props based on what we have
  const avatarProps = () => {
    if (props.id) {
      return { id: props.id, photoUrl: props.photoUrl } as const;
    }
    if (props.email) {
      return { email: props.email, photoUrl: props.photoUrl } as const;
    }
    // Fallback - use email even if empty to satisfy the union type
    return { email: '?', photoUrl: props.photoUrl } as const;
  };

  return (
    <Surface active depth={2} class="rounded-xl shadow-lg shadow-drop-shadow">
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
          <div class="p-1.5 flex flex-col gap-0.5">
            <Show when={props.email}>
              <ActionItem onClick={handleCopyEmail}>
                {copied() ? (
                  <IconCheck class="size-3.5" />
                ) : (
                  <WideCopy class="size-3.5" />
                )}
                Copy email
              </ActionItem>
            </Show>
            <Show when={canTreatAsUser() && props.id !== currentUserId()}>
              <ActionItem onClick={openDM}>
                <WideChat class="size-3.5" />
                DM
              </ActionItem>
            </Show>
            <Show when={canTreatAsUser()}>
              <ActionItem onClick={openTaskComposer}>
                <WideTask class="size-3.5" />
                Assign task
              </ActionItem>
            </Show>
          </div>
        </Show>
      </div>
    </Surface>
  );
}

function ActionItem(props: {
  children: JSX.Element;
  onClick: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
  class?: string;
}) {
  return (
    <button
      type="button"
      class={cn(
        'group rounded-lg w-full flex items-center gap-2 px-2 h-8 text-left font-medium text-xs cursor-default outline-none hover:bg-ink/5 focus:bg-ink/5 data-highlighted:bg-ink/5 data-disabled:opacity-50 data-disabled:cursor-not-allowed',
        props.class
      )}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
