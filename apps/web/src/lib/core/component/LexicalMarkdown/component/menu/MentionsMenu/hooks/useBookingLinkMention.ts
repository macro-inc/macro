import type {
  EventType,
  SchedulingProfile,
} from '@app/features/scheduling/core/types';
import { schedulingKeys } from '@app/features/scheduling/queries/keys';
import { throwOnErr } from '@core/util/result';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { schedulingClient } from '@service-email/scheduling';
import { createLazyMemo } from '@solid-primitives/memo';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import type { BookingLinkMentionItem } from '../../../../utils/mentionsUtils';

export type UseBookingLinkMentionOptions = {
  /** Whether to fetch booking links. */
  enabled: Accessor<boolean>;
  /** Current search term; booking links only show when empty. */
  searchTerm: Accessor<string>;
};

function profileBookingLinks(
  profile: SchedulingProfile,
  owner: string
): Array<{ event: EventType; owner: string; profileId: string }> {
  return profile.eventTypes
    .filter((event) => event.enabled)
    .map((event) => ({ event, owner, profileId: profile.id }));
}

// Cached callbacks stay at module scope so they never retain the composer.
function bookingSettingsQueryOptions(
  scopeId: string,
  teamId: string | undefined,
  enabled: boolean
) {
  return queryOptions({
    queryKey: schedulingKeys.settings(scopeId).queryKey,
    queryFn: async () =>
      (await throwOnErr(() => schedulingClient.settings(teamId))).profile,
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}

export function useBookingLinkMention(options: UseBookingLinkMentionOptions) {
  const { enabled, searchTerm } = options;

  const shouldFetch = () => enabled() && searchTerm().trim() === '';

  const personal = useQuery(() =>
    bookingSettingsQueryOptions('me', undefined, shouldFetch())
  );

  const team = useCurrentTeamQuery(shouldFetch);
  const teamId = () => (team.isSuccess ? team.data?.team.id : undefined);
  const teamName = () => (team.isSuccess ? team.data?.team.name : undefined);

  const teamProfile = useQuery(() =>
    bookingSettingsQueryOptions(
      teamId() ?? '',
      teamId(),
      shouldFetch() && !!teamId()
    )
  );

  const bookingLinks = createLazyMemo((): BookingLinkMentionItem[] => {
    if (!shouldFetch()) return [];
    if (!personal.isSuccess) return [];

    const personalLinks = profileBookingLinks(personal.data, 'Personal');

    const teamLinks =
      teamName() && teamProfile.isSuccess
        ? profileBookingLinks(teamProfile.data, teamName()!)
        : [];

    return [...personalLinks, ...teamLinks].map((link) => ({
      kind: 'bookingLink' as const,
      id: `${link.profileId}:${link.event.id}`,
      data: {
        profileId: link.profileId,
        slug: link.event.slug,
        title: link.event.title,
        durationMinutes: link.event.durationMinutes,
        owner: link.owner,
      },
    }));
  });

  return {
    bookingLinks,
    isLoading: () =>
      shouldFetch() &&
      (personal.isPending || (teamId() !== undefined && teamProfile.isPending)),
  };
}
