import { CollapsibleSection } from '@app/components/view-shell';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import type { CalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';
import {
  useAvailabilityCalendarsQuery,
  useCalendarTeamIdentityQuery,
  useSetAvailabilityCalendarMutation,
  useSetTeamCalendarSharingMutation,
  useTeamCalendarMembersQuery,
  useTeamCalendarQuery,
  useTeamCalendarSharingQuery,
} from '@queries/calendar/team';
import type { CalendarTeamIdentity } from '@queries/calendar/team-keys';
import {
  type Accessor,
  createMemo,
  createSignal,
  Show,
  Suspense,
} from 'solid-js';
import { useCalendarView } from '../calendar/components/CalendarViewContext';
import { useCalendarTeamSharingFlag } from '../calendar/hooks/use-calendar-ui-flag';
import { isCalendarRangeSupported } from '../calendar/utils/calendar-supported-range';
import { useCalendarPreferences } from '../calendar/utils/preferences';
import { TeamCalendarControls } from './components/team-calendar-controls';
import { TeamSharingSettings } from './components/team-sharing-settings';
import {
  type CalendarTeamMemberDisplay,
  teamCalendarColor,
  teamCalendarSourceId,
} from './core/model';
import { createTeamCalendarState } from './primitives/create-team-calendar-state';
import { mapTeamCalendarItem } from './queries/map';

const teammateName = (id: string) =>
  getDisplayName(tryMacroId(id)) || 'Teammate';

function useCalendarTeamIdentity(enabled: Accessor<boolean>) {
  const userId = useUserId();
  const query = useCalendarTeamIdentityQuery(userId, enabled);
  const identity = (): CalendarTeamIdentity | undefined => {
    if (!enabled() || !query.isSuccess || query.isPaused) return undefined;
    const team = query.data;
    const user = userId();
    if (!user || !team?.members.some((member) => member.user_id === user))
      return undefined;
    return { userId: user, teamId: team.team.id };
  };
  return { identity, query };
}

/** Production wiring for the isolated, read-only team overlay. */
export function useTeamCalendarOverlay(options: {
  range: Accessor<CalendarOccurrenceQueryRange | undefined>;
  enabled: Accessor<boolean>;
  isSourceVisible: (sourceId: string) => boolean;
}) {
  const flag = useCalendarTeamSharingFlag();
  const enabled = () =>
    flag() &&
    options.enabled() &&
    options.range() !== undefined &&
    isCalendarRangeSupported(options.range()!);
  const { identity, query: identityQuery } = useCalendarTeamIdentity(enabled);
  const query = useTeamCalendarQuery(identity, options.range, enabled);
  const state = createTeamCalendarState(
    {
      data: () =>
        identity() && query.isSuccess ? query.data.items : undefined,
      isPending: () =>
        identityQuery.isPending ||
        (identity() !== undefined && query.isPending),
      isError: () => identityQuery.isError || query.isError,
      isPaused: () => identityQuery.isPaused || query.isPaused,
    },
    enabled
  );
  const events = createMemo(() =>
    state
      .items()
      .map((item) => mapTeamCalendarItem(item, teammateName(item.ownerId)))
      .filter((event) => options.isSourceVisible(event.calendar.id))
  );
  return {
    events,
    isLoading: state.isLoading,
    isError: state.isError,
    retry: () => {
      void identityQuery.refetch();
      void query.refetch();
    },
  };
}

function TeamCalendarControlsConnected(props: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  isVisible: (sourceId: string) => boolean;
  onVisibilityChange: (sourceId: string, visible: boolean) => void;
}) {
  const flag = useCalendarTeamSharingFlag();
  const { identity, query: identityQuery } = useCalendarTeamIdentity(flag);
  const query = useTeamCalendarMembersQuery(identity);
  const members = createMemo<CalendarTeamMemberDisplay[]>(() =>
    identity() && query.isSuccess && !query.isPaused
      ? query.data.map((member) => ({
          ...member,
          name: teammateName(member.userId),
          color: teamCalendarColor(member.userId),
          sourceId: teamCalendarSourceId(member.userId),
        }))
      : []
  );
  return (
    <Show
      when={
        identity() ||
        identityQuery.isPending ||
        identityQuery.isError ||
        identityQuery.isPaused
      }
    >
      <TeamCalendarControls
        {...props}
        members={members()}
        loading={
          identityQuery.isPending ||
          (identity() !== undefined && query.isPending)
        }
        error={
          query.isError ||
          identityQuery.isError ||
          query.isPaused ||
          identityQuery.isPaused
        }
        onRetry={() => {
          void identityQuery.refetch();
          void query.refetch();
        }}
      />
    </Show>
  );
}

export function CalendarTeamSidebar() {
  const enabled = useCalendarTeamSharingFlag();
  const calendar = useCalendarView();
  const [open, setOpen] = createSignal(true);
  return (
    <Show when={enabled()}>
      <Suspense
        fallback={
          <p class="px-2 text-xs text-ink-muted">Loading team calendars…</p>
        }
      >
        <CollapsibleSection.Root open={open()} onOpenChange={setOpen}>
          <CollapsibleSection.Trigger>
            <span>Team calendars</span>
            <CollapsibleSection.Indicator />
          </CollapsibleSection.Trigger>
          <CollapsibleSection.Content>
            <TeamCalendarControlsConnected
              enabled={calendar.displaySettings.showTeamCalendars}
              onEnabledChange={calendar.setShowTeamCalendars}
              isVisible={calendar.isSourceVisible}
              onVisibilityChange={calendar.setSourceVisibility}
            />
          </CollapsibleSection.Content>
        </CollapsibleSection.Root>
      </Suspense>
    </Show>
  );
}

function CalendarTeamSettingsContent() {
  const flag = useCalendarTeamSharingFlag();
  const { identity, query: identityQuery } = useCalendarTeamIdentity(flag);
  const sharing = useTeamCalendarSharingQuery(identity);
  const calendars = useAvailabilityCalendarsQuery(identity);
  const setSharing = useSetTeamCalendarSharingMutation();
  const setCalendar = useSetAvailabilityCalendarMutation();
  const [preferences, setPreferences] = useCalendarPreferences();
  return (
    <>
      <TeamSharingSettings
        hasTeam={identity() !== undefined}
        teamLoading={identityQuery.isPending}
        sharing={
          sharing.isSuccess && !sharing.isPaused
            ? sharing.data.sharing
            : undefined
        }
        saving={setSharing.isPending}
        error={
          sharing.isError ||
          identityQuery.isError ||
          sharing.isPaused ||
          identityQuery.isPaused
        }
        onChange={(value) =>
          setSharing.mutate(value, {
            onError: () => toast.failure('Could not update calendar sharing'),
          })
        }
        onRetry={() => {
          void identityQuery.refetch();
          void sharing.refetch();
        }}
        calendars={
          calendars.isSuccess && !calendars.isPaused
            ? calendars.data.calendars
            : []
        }
        calendarsLoading={identity() !== undefined && calendars.isPending}
        calendarsError={calendars.isError || calendars.isPaused}
        calendarSaving={setCalendar.isPending}
        onCalendarChange={(calendarId, contributesToAvailability) =>
          setCalendar.mutate(
            { calendarId, contributesToAvailability },
            {
              onError: () =>
                toast.failure('Could not update availability calendar'),
            }
          )
        }
      />
      <TeamCalendarControlsConnected
        enabled={preferences.showTeamCalendars}
        onEnabledChange={(visible) =>
          setPreferences('showTeamCalendars', visible)
        }
        isVisible={(id) => !preferences.hiddenSourceIds.includes(id)}
        onVisibilityChange={(id, visible) =>
          setPreferences('hiddenSourceIds', (ids) =>
            visible
              ? ids.filter((source) => source !== id)
              : [...new Set([...ids, id])]
          )
        }
      />
    </>
  );
}

export function CalendarTeamSettings() {
  const enabled = useCalendarTeamSharingFlag();
  return (
    <Show when={enabled()}>
      <Suspense
        fallback={
          <p class="px-6 text-sm text-ink-muted">
            Loading team calendar settings…
          </p>
        }
      >
        <CalendarTeamSettingsContent />
      </Suspense>
    </Show>
  );
}
