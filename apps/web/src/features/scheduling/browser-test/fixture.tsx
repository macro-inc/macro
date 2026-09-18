import { macroDarkTheme } from '../../theme/themes/macro-dark';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { themeCssVars } from '../../theme/utils/themeColorTokens';
import { BookingReceiptView } from '../views/booking-receipt-view';
import '@fontsource-variable/inter';
import '../../../index.css';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import {
  type SchedulingCapabilities,
  SchedulingProvider,
} from '../context/scheduling-context';
import {
  type Booking,
  type BookingReceipt,
  newEventType,
  newSchedule,
  type PublicProfile,
  type SchedulingProfile,
} from '../core/types';
import { PublicBookingView } from '../views/public-booking-view';
import { SchedulingSettingsView } from '../views/settings-view';

function Fixture() {
  const [loseNextResponse, setLoseNextResponse] = createSignal(false);
  const receipts = new Map<string, BookingReceipt>();
  const [narrow, setNarrow] = createSignal(false);
  const [dark, setDark] = createSignal(false);
  const applyTheme = (isDark: boolean) => {
    setDark(isDark);
    const base = isDark ? macroDarkTheme : macroLightTheme;
    const vars = themeCssVars({
      ...base,
      colorTokens: {
        ...base.colorTokens,
        'surface-0': isDark ? '#111111' : '#fafafa',
        'surface-1': isDark ? '#202020' : '#f7f7f8',
        'surface-2': isDark ? '#202020' : '#ffffff',
        'surface-3': isDark ? '#292929' : '#ffffff',
        'surface-4': isDark ? '#333333' : '#ffffff',
        panel: isDark ? '#181818' : '#ffffff',
        accent: isDark ? '#eeeeee' : '#171717',
        edge: isDark ? '#3a3a3a' : '#dedede',
        'edge-muted': isDark ? '#2e2e2e' : '#e5e5e5',
      },
    });
    for (const [key, value] of Object.entries(vars))
      document.documentElement.style.setProperty(key, value);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  };
  onMount(() => applyTheme(false));
  const [screen, setScreen] = createSignal<'settings' | 'public' | 'receipt'>(
    'settings'
  );
  const [slug, setSlug] = createSignal<string>();
  const schedule = newSchedule('America/New_York');
  const event = {
    ...newEventType(schedule.id, ['macro|alex@example.com'], false),
    title: '30 minute meeting',
    slug: '30-minute-meeting',
    enabled: true,
    description:
      'A little time to connect, share ideas, and talk through what’s next.',
  };
  const [profileStore, setProfiles] = createStore<
    Record<string, SchedulingProfile>
  >({
    me: {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Alex Morgan',
      description: 'Find a time that works for you.',
      schedules: [schedule],
      defaultScheduleId: schedule.id,
      eventTypes: [event],
      revision: 1,
    },
    team: {
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Design team',
      description: 'Meet the team.',
      schedules: [schedule],
      defaultScheduleId: schedule.id,
      eventTypes: [
        {
          ...event,
          id: crypto.randomUUID(),
          title: 'Team introduction',
          slug: 'team-introduction',
          mode: 'collective',
          hosts: ['macro|alex@example.com', 'macro|sam@example.com'],
        },
      ],
      revision: 1,
    },
  });
  // Match the reactive store data returned by Solid Query in the real app.
  const profiles = () => profileStore;
  const [active, setActive] = createSignal('me');
  type PreviewBooking = Booking & { profileId: string };
  const sampleBookings = Object.values(profiles()).flatMap((profile, owner) =>
    Array.from({ length: 34 }, (_, i): PreviewBooking => {
      const date = new Date();
      date.setUTCHours(14 + (i % 5), 0, 0, 0);
      date.setUTCDate(date.getUTCDate() - 12 + Math.floor(i / 2));
      const cancelled = i % 9 === 0;
      return {
        id: `sample-${owner}-${i}`,
        profileId: profile.id,
        eventTypeId: profile.eventTypes[0].id,
        title: profile.eventTypes[0].title,
        name: ['Jordan Lee', 'Taylor Chen', 'Casey Williams', 'Morgan Patel'][
          i % 4
        ],
        email: `guest${i}@example.com`,
        startsAt: date.toISOString(),
        endsAt: new Date(date.getTime() + 1800000).toISOString(),
        timeZone: 'America/New_York',
        hosts: profile.eventTypes[0].hosts,
        status: cancelled
          ? 'cancelled'
          : i > 28 && i % 2 === 0
            ? 'pending'
            : 'confirmed',
        location: 'Google Meet',
        answers: {},
        rescheduleCount: i % 7 === 0 ? 1 : 0,
        rescheduledAt:
          i % 7 === 0
            ? new Date(date.getTime() - 86400000).toISOString()
            : null,
        attendance:
          date < new Date() && !cancelled
            ? i % 11 === 0
              ? 'guestNoShow'
              : i % 13 === 0
                ? 'hostNoShow'
                : 'attended'
            : 'unknown',
      };
    })
  );
  const [bookings, setBookings] =
    createSignal<PreviewBooking[]>(sampleBookings);
  const [notice, setNotice] = createSignal('');
  const [receipt, setReceipt] = createSignal<BookingReceipt>();
  const updateReceipt = (booking: Booking) => {
    setBookings(
      bookings().map((b) => (b.id === booking.id ? { ...b, ...booking } : b))
    );
    setReceipt((r) => (r ? { ...r, booking } : r));
  };
  const sampleSlots = (date: string) =>
    [14, 15, 16].map((hour) => ({
      startsAt: `${date}T${hour}:00:00Z`,
      endsAt: `${date}T${hour}:30:00Z`,
    }));
  const current = () => profiles()[active()];
  const publicProfile = (): PublicProfile => ({
    ...current(),
    eventTypes: current().eventTypes.filter((e) => e.enabled),
  });
  onMount(() => {
    const followPreview = () => {
      const parts = location.hash.slice(1).split('/');
      if (parts[0] !== 'preview') return;
      const entry = Object.entries(profiles()).find(
        ([, p]) => p.id === parts[1]
      );
      if (!entry) return;
      setActive(entry[0]);
      setSlug(parts[2] || undefined);
      setScreen('public');
    };
    followPreview();
    window.addEventListener('hashchange', followPreview);
    onCleanup(() => window.removeEventListener('hashchange', followPreview));
  });
  let selectedScope = () => 'me';
  const capabilities: SchedulingCapabilities = {
    userId: () => 'macro|alex@example.com',
    scopes: () => [
      { id: 'me', name: 'Personal', canEdit: true },
      { id: 'team', teamId: 'team', name: 'Design team', canEdit: true },
      {
        id: 'readonly',
        teamId: 'team',
        name: 'Team member (read only)',
        canEdit: false,
      },
    ],
    members: () => [
      {
        id: 'macro|alex@example.com',
        name: 'Alex Morgan',
        email: 'alex@example.com',
      },
      {
        id: 'macro|sam@example.com',
        name: 'Sam Rivera',
        email: 'sam@example.com',
      },
    ],
    link: (p, s) => `#preview/${p.id}/${s ?? ''}`,
    copyLink: async () => {
      setNotice('Booking link copied (isolated preview)');
    },
    manageBooking: async (id) => {
      const booking = bookings().find((b) => b.id === id);
      if (booking) {
        setReceipt({
          booking,
          token: 'sample',
          scheduleTimeZone: 'America/New_York',
        });
        setScreen('receipt');
      }
    },
    openConnections: () => setNotice('Calendar connection shortcut selected'),
    openTeamSettings: () => setNotice('Macro team settings shortcut selected'),
    createSource: (scope) => {
      selectedScope = () => (scope().id === 'readonly' ? 'team' : scope().id);
      return {
        profile: () =>
          profiles()[scope().id === 'readonly' ? 'team' : scope().id],
        bookings: () =>
          bookings().filter(
            (b) =>
              b.profileId ===
              profiles()[scope().id === 'readonly' ? 'team' : scope().id].id
          ),
        loadInsights: async (from, to) =>
          bookings().filter(
            (b) =>
              b.profileId ===
                profiles()[scope().id === 'readonly' ? 'team' : scope().id]
                  .id &&
              b.startsAt >= from &&
              b.startsAt < to
          ),
        setAttendance: async (id, attendance) => {
          const booking = bookings().find((b) => b.id === id);
          if (
            !booking ||
            (!scope().canEdit &&
              !booking.hosts.includes('macro|alex@example.com'))
          )
            throw new Error('Forbidden');
          if (
            booking.status !== 'confirmed' ||
            new Date(booking.endsAt) > new Date()
          )
            throw new Error('Attendance is available after the meeting ends.');
          setBookings(
            bookings().map((b) => (b.id === id ? { ...b, attendance } : b))
          );
        },
        loading: () => false,
        error: () => undefined,
        saving: () => false,
        reload: () => {},
        save: async (p) => {
          if (!scope().canEdit) throw new Error('Forbidden');
          setProfiles({
            ...profiles(),
            [scope().id]: { ...p, revision: p.revision + 1 },
          });
          setActive(scope().id);
        },
        approve: async (id) => {
          setBookings(
            bookings().map((b) =>
              b.id === id ? { ...b, status: 'confirmed' } : b
            )
          );
        },
        cancel: async (id) => {
          setBookings(
            bookings().map((b) =>
              b.id === id ? { ...b, status: 'cancelled' } : b
            )
          );
        },
      };
    },
  };
  return (
    <div class="flex h-screen flex-col bg-panel text-ink">
      <div class="flex flex-wrap items-center gap-3 shrink-0 border-b border-edge-muted bg-panel px-5 py-3 text-xs">
        <strong>Isolated scheduling preview</strong>
        <span class="text-ink-muted">
          Sample data only · no invitations sent
        </span>
        <button type="button" onClick={() => setScreen('settings')}>
          Settings
        </button>
        <button
          type="button"
          onClick={() => {
            setActive(selectedScope());
            setSlug(undefined);
            setScreen('public');
          }}
        >
          Public booking page
        </button>
        <button type="button" onClick={() => applyTheme(!dark())}>
          {dark() ? 'Light preview' : 'Dark preview'}
        </button>
        <button type="button" onClick={() => setNarrow(!narrow())}>
          {narrow() ? 'Full width' : 'Mobile width'}
        </button>
        <button type="button" onClick={() => setLoseNextResponse(true)}>
          {loseNextResponse()
            ? 'Lost response armed'
            : 'Simulate lost booking response'}
        </button>
        <span role="status">{notice()}</span>
      </div>
      <div
        class="min-h-0 flex-1 mx-auto w-full"
        style={{ 'max-width': narrow() ? '390px' : undefined }}
      >
        <Show when={screen() === 'settings'}>
          <SchedulingProvider value={capabilities}>
            <SchedulingSettingsView />
          </SchedulingProvider>
        </Show>
        <Show when={screen() === 'public'}>
          <PublicBookingView
            profile={publicProfile()}
            event={publicProfile().eventTypes.find((e) => e.slug === slug())}
            onEvent={setSlug}
            onReceipt={(r) => {
              setReceipt(r);
              setScreen('receipt');
            }}
            source={{
              slots: async (_p, _e, date) =>
                [14, 15, 16].map((hour) => ({
                  startsAt: `${date}T${hour}:00:00Z`,
                  endsAt: `${date}T${hour}:30:00Z`,
                })),
              book: async (_p, eventId, r) => {
                const existing = receipts.get(r.requestId);
                if (existing) return existing;
                const e = current().eventTypes.find((e) => e.id === eventId)!;
                const booking: PreviewBooking = {
                  profileId: current().id,
                  attendance: 'unknown',
                  rescheduleCount: 0,
                  rescheduledAt: null,
                  id: crypto.randomUUID(),
                  eventTypeId: eventId,
                  title: e.title,
                  name: r.name,
                  email: r.email,
                  startsAt: r.startsAt,
                  endsAt: new Date(
                    new Date(r.startsAt).getTime() + e.durationMinutes * 60000
                  ).toISOString(),
                  timeZone: r.timeZone,
                  hosts: e.hosts,
                  status: e.requiresConfirmation ? 'pending' : 'confirmed',
                  location: 'Google Meet',
                  answers: r.answers,
                };
                setBookings([...bookings(), booking]);
                const receipt = {
                  booking,
                  token: crypto.randomUUID(),
                  scheduleTimeZone: 'America/New_York',
                };
                receipts.set(r.requestId, receipt);
                if (loseNextResponse()) {
                  setLoseNextResponse(false);
                  throw new Error('Injected lost response after reservation');
                }
                return receipt;
              },
            }}
          />
        </Show>
        <Show when={screen() === 'receipt'}>
          <BookingReceiptView
            receipt={receipt()}
            unavailable={false}
            cancel={async () => {
              const r = receipt();
              if (r) updateReceipt({ ...r.booking, status: 'cancelled' });
            }}
            loadSlots={async (date) => sampleSlots(date)}
            reschedule={async (start) => {
              const r = receipt();
              if (r) {
                const duration =
                  new Date(r.booking.endsAt).getTime() -
                  new Date(r.booking.startsAt).getTime();
                updateReceipt({
                  ...r.booking,
                  startsAt: start,
                  rescheduleCount: (r.booking.rescheduleCount ?? 0) + 1,
                  rescheduledAt: new Date().toISOString(),
                  attendance: 'unknown',
                  endsAt: new Date(
                    new Date(start).getTime() + duration
                  ).toISOString(),
                });
              }
            }}
          />
        </Show>
      </div>
    </div>
  );
}
const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
