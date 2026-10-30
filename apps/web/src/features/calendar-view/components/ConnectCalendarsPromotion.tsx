import { useLoadedCalendarAccounts } from '@app/features/calendar/hooks/use-calendar-accounts';
import { CALENDAR_ACCOUNTS_PROMOTION as COPY } from '@app/features/sidebar-promotion/core/promotions';
import { createLastKnown } from '@app/features/sidebar-promotion/primitives/last-known';
import {
  allOf,
  flagVerdict,
  SidebarPromotion,
} from '@app/features/sidebar-promotion/sidebar-promotion';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableMultiInbox,
  enableSidebarPromotions,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { useAddInboxFlow } from '@core/email-link';
import { fireAndForget } from '@core/util/fireAndForget';
import { untrack } from 'solid-js';
import { match } from 'ts-pattern';
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
      kind: z.enum(['enable', 'reconnect']),
      emailAddress: z.string(),
      scopes: scopesSchema,
    })
    .optional(),
});
type CardState = z.infer<typeof cardStateSchema>;

/**
 * The Calendar sidebar's prompt to connect another Google account. Adding
 * accounts follows the multi-inbox flag, like "Connect another account" in
 * the calendar settings menu.
 */
export function ConnectCalendarsPromotion(props: { class?: string }) {
  const promotions = useFeatureFlag(enableSidebarPromotions);
  const multiInbox = useFeatureFlag(enableMultiInbox);
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
                kind: attention.action,
                emailAddress: attention.emailAddress,
                scopes: attention.consentScopes,
              }
            : undefined,
      };
    },
    cardStateSchema
  );
  const action = () => {
    const fix = state()?.fix;
    if (!fix)
      return {
        label: COPY.action,
        // A brand-new account needs the mailbox scopes alongside calendar.
        onClick: () =>
          fireAndForget(
            startAddInbox({ scopes: 'gmail_and_calendar' }),
            'sidebar-promotion.calendar'
          ),
      };
    return {
      label: match(fix.kind)
        .with('reconnect', () => COPY.reconnectAction)
        .with('enable', () => COPY.enableAction)
        .exhaustive(),
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
  return (
    <SidebarPromotion
      id={COPY.id}
      applies={allOf(
        flagVerdict(promotions()),
        flagVerdict(multiInbox()),
        state() === undefined ? undefined : !state()?.satisfied
      )}
      logos={COPY.logos}
      headline={COPY.headline}
      pitch={COPY.pitch}
      class={props.class}
      dismissLabel="Dismiss connect more calendars"
      action={action()}
    />
  );
}
