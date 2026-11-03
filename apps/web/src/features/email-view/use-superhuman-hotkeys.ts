import { fromInboxOptions } from '@app/features/email-compose/core/email-sender';
import { useHotkeyProfiles } from '@app/features/hotkey-profiles/context/hotkey-profiles-context';
import { SUPERHUMAN } from '@app/features/hotkey-profiles/core/profiles';
import { useHotkeyProfile } from '@app/features/hotkey-profiles/primitives/use-hotkey-profile';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useMailAccountsQuery } from '@queries/email/mail-accounts';
import { composeEmail } from './compose-email';
import { useEmailView } from './email-view-context';
import { useVisibleEmailTab } from './use-visible-email-tab';

export type UseSuperhumanHotkeysOptions = {
  scopeId: string;
  enabled: () => boolean;
  /** The list is on screen and has the keyboard, not the reader or a thread. */
  listHasKeyboard: () => boolean;
};

/** Superhuman's keys across the Email view, for people who turned them on. */
export function useSuperhumanHotkeys(options: UseSuperhumanHotkeysOptions) {
  const { state, setTab, setFacets, setInboxIds } = useEmailView();
  const isVisible = useVisibleEmailTab();
  const { openWithSplit } = useSplitLayout();
  const profiles = useHotkeyProfiles();
  const accounts = useMailAccountsQuery(
    () => profiles.activeProfile('email') === SUPERHUMAN.id
  );

  useHotkeyProfile(SUPERHUMAN, {
    scopeId: options.scopeId,
    enabled: options.enabled,
    actions: {
      compose: () => {
        composeEmail(openWithSplit, state.inboxIds);
        return true;
      },
      composeInNewSplit: () => {
        composeEmail(openWithSplit, state.inboxIds, undefined, {
          newSplit: true,
        });
        return true;
      },
      showUnread: () => {
        if (!options.listHasKeyboard()) return false;
        const read = state.facets.read ?? [];
        setFacets({
          ...state.facets,
          read: read.includes('unread') ? [] : ['unread'],
        });
        return true;
      },
      showFavorites: () => {
        setTab('favorites');
        return true;
      },
      showSignal: () => {
        setTab('important');
        return true;
      },
      // Superhuman's "no reply" split: threads waiting on someone else.
      showFollowUps: () => {
        if (!isVisible('focus')) return false;
        setTab('focus');
        setFacets({ focus: ['focus-follow-up'] });
        return true;
      },
      showReminders: () => {
        if (!isVisible('reminders')) return false;
        setTab('reminders');
        return true;
      },
      // In the order the inbox picker lists them.
      showAccount: (index) => {
        const links = accounts.isSuccess ? (accounts.data?.links ?? []) : [];
        const account = fromInboxOptions(links).filter(
          (option) => !option.isAlias
        )[index];
        if (!account) return false;
        setInboxIds([account.inboxId]);
        return true;
      },
    },
  });
}
