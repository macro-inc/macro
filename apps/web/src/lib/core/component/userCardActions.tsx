import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { enableCrm } from '@core/constant/featureFlags';
import { isBotPrincipalId } from '@core/constant/macroAgent';
import { useUserId } from '@core/context/user';
import { useIsConnectedSecondaryInbox } from '@core/user';
import WideContact from '@phosphor/address-book.svg';
import WideChat from '@phosphor/chat.svg';
import CopyIcon from '@phosphor/copy.svg';
import WideTask from '@phosphor/list-checks.svg';
import { useGetOrCreateDirectMessageMutation } from '@queries/channel/get-or-create-dm';
import { useCrmContactByEmailQuery } from '@queries/crm/contacts';
import { useCurrentTeamQuery } from '@queries/team/teams';
import {
  type Accessor,
  type Component,
  type ComponentProps,
  createMemo,
} from 'solid-js';

/** The person a user card describes. */
export type UserCardTarget = {
  displayName: string;
  email?: string;
  id?: string;
  isDeleted?: boolean;
  photoUrl?: string;
};

type UserCardActionId =
  | 'copy-email'
  | 'copy-name'
  | 'open-contact'
  | 'dm'
  | 'assign-task';

export type UserCardAction = {
  id: UserCardActionId;
  label: string;
  icon: Component<ComponentProps<'svg'>>;
  /** Writes to the clipboard: confirm in place instead of dismissing the card. */
  copies?: boolean;
  onSelect: (event: MouseEvent) => void | Promise<void>;
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

/**
 * The actions a user card offers, shared by every presentation of it: the
 * hover card on pointer devices and the bottom sheet on touch ones.
 *
 * Dismissal is left to the caller — a hover card stays open to show that a
 * copy landed, a sheet closes after a successful action.
 */
export function useUserCardActions(
  target: Accessor<UserCardTarget>
): Accessor<UserCardAction[]> {
  const currentUserId = useUserId();
  const isConnectedSecondaryInbox = useIsConnectedSecondaryInbox();
  const { openWithSplit, popoverSplit } = useSplitLayout();
  const crmFlag = useFeatureFlag(enableCrm);
  const getOrCreateDmMutation = useGetOrCreateDirectMessageMutation({
    onError: () => toast.failure('Failed to open direct message'),
  });

  const userId = () => target().id;
  const canTreatAsUser = () =>
    !!userId() && !target().isDeleted && !isConnectedSecondaryInbox(userId());
  // An agent is mentioned like a person and hovers like one, but there is
  // nobody on the other end of a direct message to it: an agent answers where
  // it was mentioned, and a DM channel it never reads would look like a
  // conversation that is simply being ignored.
  const canDirectMessage = () =>
    canTreatAsUser() && !isBotPrincipalId(userId());

  // Only the CRM contact lookup needs the team, so a card on a workspace
  // without CRM never fetches one.
  const currentTeamQuery = useCurrentTeamQuery(() => crmFlag().enabled);
  // Guarded reads: an unguarded `data` suspends whoever renders the card, and
  // a card that suspends takes its hover surface or sheet down with it.
  const team = () =>
    currentTeamQuery.isSuccess ? currentTeamQuery.data?.team : undefined;
  const crmEnabled = () => crmFlag().enabled && team()?.crm_enabled === true;
  const contactQuery = useCrmContactByEmailQuery(
    () => team()?.id ?? '',
    () => target().email ?? '',
    crmEnabled
  );
  const crmContact = () =>
    crmEnabled() && contactQuery.isSuccess ? contactQuery.data : undefined;

  const copyAction = (
    id: UserCardActionId,
    label: string,
    value: string,
    toastMessage: string
  ): UserCardAction => ({
    id,
    label,
    icon: CopyIcon,
    copies: true,
    onSelect: async (event) => {
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(value);
      } catch (error) {
        toast.failure('Failed to copy to clipboard');
        throw error;
      }
      toast.success(toastMessage);
    },
  });

  const openContact = (event: MouseEvent, contactId: string) => {
    event.preventDefault();
    event.stopPropagation();
    openWithSplit(
      { type: 'contact', id: contactId },
      { preferNewSplit: event.shiftKey, reopen: 'latest' }
    );
  };

  const openDirectMessage = async (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const recipientId = userId();
    if (!recipientId) return;
    const preferNewSplit = event.shiftKey;
    // The mutation's onError callback handles failure feedback.
    const { channel_id } = await getOrCreateDmMutation.mutateAsync({
      recipient_id: recipientId,
    });
    openWithSplit(
      { type: 'channel', id: channel_id },
      { preferNewSplit, reopen: 'latest' }
    );
  };

  const openTaskComposer = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const assigneeId = userId();
    if (!assigneeId) return;
    popoverSplit({
      type: 'component',
      id: 'task-compose',
      params: { initialAssigneeIds: [assigneeId] },
    });
  };

  return createMemo(() => {
    const { displayName, email } = target();
    const actions: UserCardAction[] = [];

    if (email) {
      actions.push(
        copyAction('copy-email', 'Copy email', email, 'Email copied')
      );
    }

    const name = copyableName(displayName, email);
    if (name) {
      actions.push(copyAction('copy-name', 'Copy name', name, 'Name copied'));
    }

    const contact = crmContact();
    if (contact) {
      actions.push({
        id: 'open-contact',
        label: 'Open contact',
        icon: WideContact,
        onSelect: (event) => openContact(event, contact.id),
      });
    }

    if (canDirectMessage() && userId() !== currentUserId()) {
      actions.push({
        id: 'dm',
        label: 'DM',
        icon: WideChat,
        onSelect: openDirectMessage,
      });
    }

    if (canTreatAsUser()) {
      actions.push({
        id: 'assign-task',
        label: 'Assign task',
        icon: WideTask,
        onSelect: openTaskComposer,
      });
    }

    return actions;
  });
}
