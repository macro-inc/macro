import { toast } from '@core/component/Toast/Toast';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserContext } from '@core/context/user';
import { getDisplayName, macroIdToEmail, tryMacroId } from '@core/user';
import { writeClipboardData } from '@core/util/dataTransfer';
import { getWebOrigin } from '@core/util/webOrigin';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { useNavigate } from '@solidjs/router';
import { Suspense } from 'solid-js';
import { SchedulingProvider } from './context/scheduling-context';
import type { SchedulingProfile, SchedulingScope } from './core/types';
import {
  createSchedulingSource,
  useManageBookingMutation,
} from './queries/source';
import { SchedulingSettingsView } from './views/settings-view';

export function schedulingLink(
  profile: Pick<SchedulingProfile, 'id'>,
  slug?: string
) {
  return `${getWebOrigin()}/app/book/${encodeURIComponent(profile.id)}${slug ? `/${encodeURIComponent(slug)}` : ''}`;
}

function SchedulingSettingsContent() {
  const navigate = useNavigate();
  const manageBooking = useManageBookingMutation();
  const user = useUserContext();
  const team = useCurrentTeamQuery();
  const settings = useSettingsState();
  const currentTeam = () => (team.isSuccess ? team.data : undefined);
  const members = () =>
    currentTeam()?.members.map((m) => {
      const id = tryMacroId(m.user_id);
      return {
        id: m.user_id,
        name: id ? getDisplayName(id) : m.user_id,
        email: id ? macroIdToEmail(id) : m.user_id,
      };
    }) ?? [];
  const scopes = (): SchedulingScope[] => {
    const result: SchedulingScope[] = [
      { id: user.userId() ?? 'me', name: 'Personal', canEdit: true },
    ];
    const data = currentTeam();
    if (data) {
      const role = data.members.find((m) => m.user_id === user.userId())?.role;
      result.push({
        id: data.team.id,
        name: data.team.name,
        teamId: data.team.id,
        canEdit: role === 'admin' || role === 'owner',
      });
    }
    return result;
  };
  return (
    <SchedulingProvider
      value={{
        manageBooking: async (id) => {
          const receipt = await manageBooking.mutateAsync(id);
          settings.closeSettings();
          navigate(`/booking/${id}#${receipt.token}`);
        },
        scopes,
        members,
        userId: () => user.userId() ?? '',
        createSource: createSchedulingSource,
        link: schedulingLink,
        openConnections: () => settings.openSettings('Connected'),
        openTeamSettings: () => settings.openSettings('Team'),
        copyLink: async (profile, slug) => {
          if (
            await writeClipboardData({
              'text/plain': schedulingLink(profile, slug),
            })
          )
            toast.success('Booking link copied');
          else toast.failure('Could not copy booking link');
        },
      }}
    >
      <SchedulingSettingsView />
    </SchedulingProvider>
  );
}
export function SchedulingSettings() {
  return (
    <Suspense
      fallback={<p class="p-8 text-ink-muted">Loading calendar settings…</p>}
    >
      <SchedulingSettingsContent />
    </Suspense>
  );
}
