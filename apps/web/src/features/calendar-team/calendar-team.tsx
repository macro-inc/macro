import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  useCalendarTeamIdentityQuery,
  useSetTeamCalendarSharingMutation,
  useTeamCalendarSharingQuery,
} from '@queries/calendar/team';
import type { CalendarTeamIdentity } from '@queries/calendar/team-keys';
import { type Accessor, Show, Suspense } from 'solid-js';
import { useCalendarTeamSharingFlag } from '../calendar/hooks/use-calendar-ui-flag';
import { TeamSharingSettings } from './components/team-sharing-settings';

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

function CalendarTeamSettingsContent() {
  const flag = useCalendarTeamSharingFlag();
  const { identity, query: identityQuery } = useCalendarTeamIdentity(flag);
  const sharing = useTeamCalendarSharingQuery(identity);
  const setSharing = useSetTeamCalendarSharingMutation();
  return (
    <TeamSharingSettings
      hasTeam={identity() !== undefined}
      teamLoading={identityQuery.isPending}
      sharing={
        sharing.isSuccess && !sharing.isPaused
          ? sharing.data.sharing
          : undefined
      }
      error={
        sharing.isError ||
        identityQuery.isError ||
        sharing.isPaused ||
        identityQuery.isPaused
      }
      onChange={(value) => {
        const current = identity();
        if (!current) return;
        setSharing.mutate(
          { identity: current, sharing: value },
          {
            onError: () => toast.failure('Could not update calendar sharing'),
          }
        );
      }}
      onRetry={() => {
        fireAndForget(identityQuery.refetch(), 'calendar-team');
        fireAndForget(sharing.refetch(), 'calendar-team');
      }}
    />
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
