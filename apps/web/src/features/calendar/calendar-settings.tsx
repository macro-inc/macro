import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { toast } from '@core/component/Toast/Toast';
import { enableMultiInbox } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { useAddInboxFlow } from '@core/email-link';
import { useEmailLinksQuery } from '@queries/email/link';
import { createSignal, Suspense } from 'solid-js';
import { CalendarTeamSettings } from '../calendar-team/calendar-team';
import { SettingsPage } from '../settings/primitives';
import {
  type ConnectedCalendarAccount,
  ConnectedCalendars,
} from './components/connected-calendars';
import {
  TurnOffCalendarDialog,
  type TurnOffCalendarTarget,
} from './components/TurnOffCalendarDialog';
import { useCalendarSources } from './hooks/use-calendar-sources';
import { groupCalendarSourcesByAccount } from './utils/calendar-source-groups';
import { useCalendarPreferences } from './utils/preferences';

function CalendarSettingsContent() {
  const links = useEmailLinksQuery();
  const { sources, calendarsQuery } = useCalendarSources();
  const userId = useUserId();
  const multiInbox = useFeatureFlag(enableMultiInbox);
  const startAddInbox = useAddInboxFlow();
  const [preferences, setPreferences] = useCalendarPreferences();
  const [connecting, setConnecting] = createSignal(false);
  const [disconnect, setDisconnect] =
    createSignal<TurnOffCalendarTarget | null>(null);
  const accounts = (): ConnectedCalendarAccount[] => {
    const groups = groupCalendarSourcesByAccount(
      sources().filter((s) => s.emailLinkId)
    );
    const owned = (links.isSuccess ? (links.data?.links ?? []) : []).filter(
      (l) => l.macro_id === userId()
    );
    return [
      ...owned.map((link) => ({
        id: link.id,
        email: link.email_address,
        calendars: groups.find((g) => g.key === link.id)?.calendars ?? [],
        defaultColor: calendarsQuery.isSuccess
          ? (calendarsQuery.data?.find(
              (c) => c.emailLinkId === link.id && c.isPrimary
            )?.color ?? undefined)
          : undefined,
        needsPermission: link.needs_calendar_permission,
        canManage: true,
      })),
      ...groups
        .filter((g) => !owned.some((l) => l.id === g.key))
        .map((g) => ({
          id: g.key,
          email: g.emailAddress,
          calendars: g.calendars,
          needsPermission: false,
          canManage: false,
        })),
    ];
  };
  const connect = async (scopes: 'calendar' | 'gmail_and_calendar') => {
    if (connecting()) return;
    setConnecting(true);
    try {
      await startAddInbox({ scopes });
    } catch {
      toast.failure('Could not connect your calendar. Please try again.');
    } finally {
      setConnecting(false);
    }
  };
  return (
    <>
      <ConnectedCalendars
        accounts={accounts()}
        loading={links.isPending || calendarsQuery.isPending}
        error={links.isError || calendarsQuery.isError}
        connecting={connecting()}
        canConnect={
          links.isSuccess &&
          (!accounts().some((a) => a.canManage) || multiInbox().enabled)
        }
        onRetry={() => {
          void links.refetch();
          void calendarsQuery.refetch();
        }}
        onConnect={() => void connect('gmail_and_calendar')}
        onEnable={() => void connect('calendar')}
        onDisconnect={(account) =>
          setDisconnect({ linkId: account.id, emailAddress: account.email })
        }
        isVisible={(id) => !preferences.hiddenSourceIds.includes(id)}
        onVisibilityChange={(ids, visible) => {
          const hidden = new Set(preferences.hiddenSourceIds);
          for (const id of ids) {
            if (visible) hidden.delete(id);
            else hidden.add(id);
          }
          setPreferences('hiddenSourceIds', [...hidden]);
        }}
        accountColor={(id) => preferences.accountColors[id]}
        sourceColor={(id) => preferences.sourceColors[id]}
        onAccountColor={(id, color) =>
          setPreferences('accountColors', id, color)
        }
        onSourceColor={(id, color) => setPreferences('sourceColors', id, color)}
      />
      <TurnOffCalendarDialog
        target={disconnect()}
        onClose={() => setDisconnect(null)}
      />
    </>
  );
}

export function CalendarConnectionSettings() {
  return (
    <Suspense
      fallback={
        <p class="px-6 text-sm text-ink-muted">Loading calendar connections…</p>
      }
    >
      <CalendarSettingsContent />
    </Suspense>
  );
}

export function CalendarSettings() {
  return (
    <SettingsPage
      title="Calendar"
      description="Manage your connected accounts, calendar visibility, and colors."
    >
      <CalendarConnectionSettings />
      <CalendarTeamSettings />
    </SettingsPage>
  );
}
