import { openChatWithInput } from '@app/features/chat/ChatWithAgentButton';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { createSearchParams, useBeforeLeave } from '@app/lib/split-router';
import { useSplitDisplayName } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { toast } from '@core/component/Toast/Toast';
import { enableCalendarScheduling } from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserContext } from '@core/context/user';
import { getDisplayName, macroIdToEmail, tryMacroId } from '@core/user';
import { writeClipboardData } from '@core/util/dataTransfer';
import { getWebOrigin } from '@core/util/webOrigin';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { useNavigate } from '@solidjs/router';
import { type ParentProps, Show, Suspense } from 'solid-js';
import { bookingLinksSearch } from './booking-links-search';
import { SchedulingProvider } from './context/scheduling-context';
import { bookingLinkAgentSeed } from './core/booking-agent';
import type { SchedulingProfile, SchedulingScope } from './core/types';
import {
  createSchedulingSource,
  useManageBookingMutation,
} from './queries/source';
import { BookingWorkspaceView } from './views/booking-workspace-view';

export function schedulingLink(
  profile: Pick<SchedulingProfile, 'id'>,
  slug?: string
) {
  return `${getWebOrigin()}/app/book/${encodeURIComponent(profile.id)}${slug ? `/${encodeURIComponent(slug)}` : ''}`;
}

function SchedulingHost(props: ParentProps) {
  const navigate = useNavigate();
  const manageBooking = useManageBookingMutation();
  const user = useUserContext();
  const team = useCurrentTeamQuery();
  const settings = useSettingsState();
  const currentTeam = () => (team.isSuccess ? team.data : undefined);
  const members = () => {
    const result = (currentTeam()?.members ?? []).map((member) => {
      const id = tryMacroId(member.user_id);
      return {
        id: member.user_id,
        name: id ? getDisplayName(id) : member.user_id,
        email: id ? macroIdToEmail(id) : member.user_id,
      };
    });
    const userId = user.userId();
    if (userId && !result.some((member) => member.id === userId)) {
      const id = tryMacroId(userId);
      result.push({
        id: userId,
        name: id ? getDisplayName(id) : userId,
        email: id ? macroIdToEmail(id) : userId,
      });
    }
    return result;
  };
  const scopes = (): SchedulingScope[] => {
    const result: SchedulingScope[] = [
      {
        id: user.userId() ?? 'me',
        name: 'Personal',
        canEdit: true,
        canManageBookings: true,
      },
    ];
    const data = currentTeam();
    if (data) {
      const role = data.members.find((m) => m.user_id === user.userId())?.role;
      result.push({
        id: data.team.id,
        name: data.team.name,
        teamId: data.team.id,
        canEdit: role !== undefined,
        canManageBookings: role === 'admin' || role === 'owner',
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
        createBookingLinkWithAgent: async (scope) => {
          const seed = bookingLinkAgentSeed(scope);
          await openChatWithInput(seed.input, {
            instructions: seed.instructions,
          });
        },
        createSource: createSchedulingSource,
        link: schedulingLink,
        openTeamSettings: () => settings.openSettings('Team'),
        copyLink: async (profile, slug) => {
          if (
            await writeClipboardData({
              'text/plain': schedulingLink(profile, slug),
            })
          ) {
            toast.success('Booking link copied');
          } else {
            toast.failure('Could not copy booking link');
            throw new Error('Could not copy booking link');
          }
        },
      }}
    >
      {props.children}
    </SchedulingProvider>
  );
}

export function BookingLinksWorkspace() {
  const flag = useFeatureFlag(enableCalendarScheduling);
  const [search, setSearch] = createSearchParams(bookingLinksSearch);
  useSplitDisplayName(() => 'Scheduling');
  let beforeLeave:
    | ((signal: AbortSignal) => boolean | Promise<boolean>)
    | undefined;
  useBeforeLeave(({ signal }) => beforeLeave?.(signal) ?? true, {
    search: [bookingLinksSearch.namespace],
  });
  return (
    <Show
      when={flag().enabled}
      fallback={
        <p class="p-8 text-sm text-ink-muted">
          {flag().loading
            ? 'Loading booking links…'
            : 'Booking links are not available.'}
        </p>
      }
    >
      <SplitPanel.Root>
        <SplitPanel.Body>
          <Suspense
            fallback={
              <p class="p-8 text-sm text-ink-muted">Loading booking links…</p>
            }
          >
            <SchedulingHost>
              <BookingWorkspaceView
                search={search}
                onSearchChange={(patch) => setSearch(patch)}
                registerBeforeLeave={(guard) => {
                  beforeLeave = guard;
                  return () => {
                    if (beforeLeave === guard) beforeLeave = undefined;
                  };
                }}
              />
            </SchedulingHost>
          </Suspense>
        </SplitPanel.Body>
      </SplitPanel.Root>
    </Show>
  );
}
