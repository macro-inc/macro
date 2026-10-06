import {
  type ConnectedCalendarAccount,
  ConnectedCalendars,
} from '../../calendar/components/connected-calendars';
import { useCalendarPreferences } from '../../calendar/utils/preferences';

/** Exercises the production controls and persisted preferences without OAuth or real accounts. */
export function FixtureCalendars(props: { notify: (message: string) => void }) {
  const [preferences, setPreferences] = useCalendarPreferences();
  const accounts: ConnectedCalendarAccount[] = [
    {
      id: 'fixture-pending',
      email: 'pending@example.com',
      needsPermission: true,
      canManage: true,
      calendars: [],
    },
    {
      id: 'fixture-work',
      email: 'alex@macro.com',
      needsPermission: false,
      canManage: true,
      calendars: [
        {
          id: 'fixture-work-primary',
          name: 'Work',
          color: '#4285f4',
          isPrimary: true,
          emailLinkId: 'fixture-work',
        },
        {
          id: 'fixture-team',
          name: 'Team events',
          color: '#33b679',
          emailLinkId: 'fixture-work',
        },
      ],
    },
    {
      id: 'fixture-personal',
      email: 'alex@gmail.com',
      needsPermission: false,
      canManage: true,
      calendars: [
        {
          id: 'fixture-personal-primary',
          name: 'Personal',
          color: '#8e24aa',
          isPrimary: true,
          emailLinkId: 'fixture-personal',
        },
        {
          id: 'fixture-holidays',
          name: 'Holidays',
          color: '#f6bf26',
          emailLinkId: 'fixture-personal',
        },
      ],
    },
  ];
  return (
    <ConnectedCalendars
      accounts={accounts.map((account) => ({
        ...account,
        defaultColor: account.calendars[0]?.color,
        calendars: account.calendars.map((calendar) => ({
          ...calendar,
          color:
            preferences.sourceColors[calendar.id] ??
            preferences.accountColors[account.id] ??
            calendar.color,
        })),
      }))}
      loading={false}
      error={false}
      connecting={false}
      canConnect={true}
      onConnect={() => props.notify('Connect account selected (preview only)')}
      onEnable={() => props.notify('Connect calendar selected (preview only)')}
      onDisconnect={() => props.notify('Disconnect selected (preview only)')}
      onRetry={() => {}}
      isVisible={(id) => !preferences.hiddenSourceIds.includes(id)}
      onVisibilityChange={(ids, visible) => {
        const hidden = new Set(preferences.hiddenSourceIds);
        for (const id of ids) {
          if (visible) hidden.delete(id);
          else hidden.add(id);
        }
        setPreferences('hiddenSourceIds', [...hidden]);
      }}
      sourceColor={(id) => preferences.sourceColors[id]}
      accountColor={(id) => preferences.accountColors[id]}
      onSourceColor={(id, color) => setPreferences('sourceColors', id, color)}
      onAccountColor={(id, color) => setPreferences('accountColors', id, color)}
    />
  );
}
