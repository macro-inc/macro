import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import {
  ENABLE_CRM_FLAG,
  ENABLE_CRM_OVERRIDE,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { useIsConnectedSecondaryInbox } from '@core/user';
import WideChat from '@icon/wide-chat.svg';
import WideContact from '@icon/wide-contact.svg';
import WideCopy from '@icon/wide-copy.svg';
import WideTask from '@icon/wide-task.svg';
import IconCheck from '@phosphor/check.svg';
import { useGetOrCreateDirectMessageMutation } from '@queries/channel/get-or-create-dm';
import { useCrmContactByEmailQuery } from '@queries/crm/contacts';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { debounce } from '@solid-primitives/scheduled';
import { cn, Surface } from '@ui';
import { createSignal, type JSX, Show, Suspense } from 'solid-js';
import { UserIcon } from './UserIcon';

type UserTooltipProps = {
  displayName: string;
  email?: string;
  id?: string;
  isDeleted?: boolean;
  onClose?: () => void;
  photoUrl?: string;
};

function copyableName(
  displayName: string,
  email: string | undefined
): string | undefined {
  const name = displayName.trim();
  if (!name) return undefined;
  if (name.toLowerCase() === 'me') return undefined;
  if (email && name.toLowerCase() === email.toLowerCase()) return undefined;
  const localPart = email?.split('@')[0];
  if (localPart && name.toLowerCase() === localPart.toLowerCase()) {
    return undefined;
  }
  return name;
}

export function UserTooltip(props: UserTooltipProps) {
  const currentUserId = useUserId();
  const isConnectedSecondaryInbox = useIsConnectedSecondaryInbox();
  const canTreatAsUser = () =>
    !!props.id && !props.isDeleted && !isConnectedSecondaryInbox(props.id);
  const { openWithSplit, popoverSplit } = useSplitLayout();
  const crmFlag = useFeatureFlag(ENABLE_CRM_FLAG, {
    enabledOverride: ENABLE_CRM_OVERRIDE,
  });
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
      openWithSplit(
        { type: 'channel', id: channel_id },
        { preferNewSplit, reopen: 'latest' }
      );
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
    <Surface depth={2} class="rounded-xl shadow-lg shadow-drop-shadow">
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

        <Show
          when={
            props.email ||
            props.id ||
            copyableName(props.displayName, props.email)
          }
        >
          <div class="border-t border-edge"></div>
          <div class="p-1.5 flex flex-col gap-0.5">
            <Show when={props.email}>
              {(email) => (
                <CopyActionItem value={email()} toastMessage="Email copied">
                  Copy email
                </CopyActionItem>
              )}
            </Show>
            <Show when={copyableName(props.displayName, props.email)}>
              {(name) => (
                <CopyActionItem value={name()} toastMessage="Name copied">
                  Copy name
                </CopyActionItem>
              )}
            </Show>
            <Show when={crmFlag().enabled ? props.email : undefined}>
              {(email) => (
                <Suspense fallback={null}>
                  <OpenContactAction email={email()} onClose={props.onClose} />
                </Suspense>
              )}
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

/**
 * Inner action: lives inside a local `<Suspense>` so the team and contact
 * lookups suspend only this button, not the tooltip.
 */
function OpenContactAction(props: { email: string; onClose?: () => void }) {
  const { openWithSplit } = useSplitLayout();
  const currentTeamQuery = useCurrentTeamQuery();
  const team = () => currentTeamQuery.data?.team;
  const crmEnabled = () => team()?.crm_enabled === true;
  const contactQuery = useCrmContactByEmailQuery(
    () => team()?.id ?? '',
    () => props.email,
    crmEnabled
  );

  const openContact = (e: MouseEvent, contactId: string) => {
    e.preventDefault();
    e.stopPropagation();
    openWithSplit(
      { type: 'contact', id: contactId },
      { preferNewSplit: e.shiftKey, reopen: 'latest' }
    );
    props.onClose?.();
  };

  return (
    <Show when={crmEnabled() ? contactQuery.data : undefined}>
      {(contact) => (
        <ActionItem onClick={(e) => openContact(e, contact().id)}>
          <WideContact class="size-3.5" />
          Open contact
        </ActionItem>
      )}
    </Show>
  );
}

function CopyActionItem(props: {
  value: string;
  toastMessage: string;
  children: JSX.Element;
}) {
  const [copied, setCopied] = createSignal(false);
  const resetCopied = debounce(() => setCopied(false), 800);

  function handleCopy(e: MouseEvent) {
    e.stopPropagation();
    setCopied(true);
    navigator.clipboard.writeText(props.value);
    toast.success(props.toastMessage);
    resetCopied();
  }

  return (
    <ActionItem onClick={handleCopy}>
      {copied() ? (
        <IconCheck class="size-3.5" />
      ) : (
        <WideCopy class="size-3.5" />
      )}
      {props.children}
    </ActionItem>
  );
}

function ActionItem(props: {
  children: JSX.Element;
  onClick: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
  class?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      class={cn(
        'group rounded-lg w-full flex items-center gap-2 px-2 h-8 text-left font-medium text-xs cursor-default outline-none hover:bg-ink/5 focus:bg-ink/5 data-highlighted:bg-ink/5 data-disabled:opacity-50 data-disabled:cursor-not-allowed',
        props.class
      )}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}
