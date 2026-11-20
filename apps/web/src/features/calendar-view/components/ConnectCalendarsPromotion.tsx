import { useLoadedCalendarAccounts } from '@app/features/calendar/hooks/use-calendar-accounts';
import { CALENDAR_ACCOUNTS_PROMOTION as COPY } from '@app/features/sidebar-promotion/core/promotions';
import { createLastKnown } from '@app/features/sidebar-promotion/primitives/last-known';
import {
  allOf,
  SidebarPromotion,
} from '@app/features/sidebar-promotion/sidebar-promotion';
import { useUserId } from '@core/context/user';
import { useAddInboxFlow } from '@core/email-link';
import { fireAndForget } from '@core/util/fireAndForget';
import { useOutlookAvailable } from '@queries/auth/outlook-link';
import { Show, untrack } from 'solid-js';
import { z } from 'zod';

/** Accounts with calendar access at which the prompt has done its job. */
const ENOUGH_CALENDAR_ACCOUNTS = 2;

const scopesSchema = z.enum(['gmail', 'gmail_and_calendar', 'calendar']);

/** What the button does, kept so the card renders before the links load. */
const cardStateSchema = z.object({
  satisfied: z.boolean(),
  /** An account already connected without (working) calendar access. */
  fix: z
    .object({
      kind: z.enum(['enable', 'stopped', 'reconnect']),
      emailAddress: z.string(),
      scopes: scopesSchema,
    })
    .optional(),
});
type CardState = z.infer<typeof cardStateSchema>;

/**
 * The Calendar sidebar's prompt to connect another calendar account. Adding
 * accounts follows the multi-inbox flag, like "Connect another account" in
 * the calendar settings menu. Its logos are the providers the button's
 * chooser offers: Outlook only while the server offers it to this user.
 *
 * While an account it can fix needs attention, the card names that account
 * and says what happened, as the calendar view's prompt and the app-wide toast
 * do, instead of inviting another account.
 */
export function ConnectCalendarsPromotion(props: { class?: string }) {
  const accounts = useLoadedCalendarAccounts();
  const userId = useUserId();
  const startAddInbox = useAddInboxFlow();
  const state = createLastKnown<CardState>(
    'calendar-accounts',
    untrack(userId),
    () => {
      const loaded = accounts();
      if (!loaded) return undefined;
      // An account needing attention comes first: the same consent the
      // calendar settings menu runs for it.
      const attention = loaded.find((account) => account.action !== 'turnOff');
      const withCalendar = loaded.filter(
        (account) => account.action === 'turnOff'
      ).length;
      return {
        satisfied: !attention && withCalendar >= ENOUGH_CALENDAR_ACCOUNTS,
        fix:
          attention && attention.action !== 'turnOff'
            ? {
                kind: attention.stoppedSyncing ? 'stopped' : attention.action,
                emailAddress: attention.emailAddress,
                scopes: attention.consentScopes,
              }
            : undefined,
      };
    },
    cardStateSchema
  );
  const applies = () => state() !== undefined && !state()?.satisfied;
  const outlookOffered = useOutlookAvailable(applies);
  const logos = () =>
    outlookOffered() ? [...COPY.logos, COPY.outlookLogo] : COPY.logos;
  /** The account needing attention and its words, if there is one. */
  const accountCase = () => {
    const fix = state()?.fix;
    return fix && { fix, copy: COPY.accountCases[fix.kind] };
  };
  const headline = () => accountCase()?.copy.headline ?? COPY.headline;
  const pitch = () => {
    const attention = accountCase();
    return attention
      ? attention.copy.pitch(attention.fix.emailAddress)
      : COPY.pitch;
  };
  const action = () => {
    const attention = accountCase();
    if (!attention)
      return {
        label: COPY.action,
        // A brand-new account needs the mailbox scopes alongside calendar.
        onClick: () =>
          fireAndForget(
            startAddInbox({ scopes: 'gmail_and_calendar' }),
            'sidebar-promotion.calendar'
          ),
      };
    const { fix, copy } = attention;
    return {
      label: copy.action,
      onClick: () =>
        fireAndForget(
          startAddInbox({
            scopes: fix.scopes,
            emailAddress: fix.emailAddress,
          }),
          'sidebar-promotion.calendar'
        ),
    };
  };
  // A card remembers whether it was shown under its id, so a new id gets a
  // new card rather than one still remembering under the old id.
  return (
    <Show when={accountCase()?.copy.id ?? COPY.id} keyed>
      {(id) => (
        <SidebarPromotion
          id={id}
          applies={allOf(
            state() === undefined ? undefined : !state()?.satisfied
          )}
          logos={logos()}
          headline={headline()}
          pitch={pitch()}
          class={props.class}
          dismissLabel={`Dismiss ${headline().toLowerCase()}`}
          action={action()}
        />
      )}
    </Show>
  );
}
