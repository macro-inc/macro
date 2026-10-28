import type {
  EventType,
  SchedulingProfile,
} from '@app/features/scheduling/core/types';
import { schedulingKeys } from '@app/features/scheduling/queries/keys';
import { createFreshSearch } from '@core/util/freshSort';
import { throwOnErr } from '@core/util/result';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { schedulingClient } from '@service-email/scheduling';
import { createLazyMemo } from '@solid-primitives/memo';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import type { BookingLinkMentionItem } from '../../../../utils/mentionsUtils';

export type UseBookingLinkMentionOptions = {
  /** Whether to fetch booking links. */
  enabled: Accessor<boolean>;
  /** Current search term, matched against booking link titles. */
  searchTerm: Accessor<string>;
};

const bookingLinkSearch = createFreshSearch<BookingLinkMentionItem>({
  config: { timeWeight: 0 },
  getName: (item) => item.data.title,
  getTimestamp: () => ({}),
});

function profileBookingLinks(
  profile: SchedulingProfile,
  owner: string
): Array<{ event: EventType; owner: string; profileId: string }> {
  return profile.eventTypes
    .filter((event) => event.enabled)
    .map((event) => ({ event, owner, profileId: profile.id }));
}

export function useBookingLinkMention(options: UseBookingLinkMentionOptions) {
  const { enabled, searchTerm } = options;

  const personal = useQuery(() => ({
    queryKey: schedulingKeys.settings('me').queryKey,
    queryFn: async () =>
      (await throwOnErr(() => schedulingClient.settings())).profile,
    enabled: enabled(),
    retry: false,
    staleTime: 30_000,
  }));

  const team = useCurrentTeamQuery(enabled);
  const teamId = () => (team.isSuccess ? team.data?.team.id : undefined);
  const teamName = () => (team.isSuccess ? team.data?.team.name : undefined);

  const teamProfile = useQuery(() => ({
    queryKey: schedulingKeys.settings(teamId() ?? '').queryKey,
    queryFn: async () =>
      (await throwOnErr(() => schedulingClient.settings(teamId()))).profile,
    enabled: enabled() && !!teamId(),
    retry: false,
    staleTime: 30_000,
  }));

  const allBookingLinks = createLazyMemo((): BookingLinkMentionItem[] => {
    if (!enabled()) return [];
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

  const bookingLinks = createLazyMemo((): BookingLinkMentionItem[] => {
    const term = searchTerm().trim();
    const links = allBookingLinks();
    if (!term) return links;
    return bookingLinkSearch(links, term).map(({ item }) => item);
  });

  return {
    bookingLinks,
    isLoading: () =>
      enabled() &&
      (personal.isPending || (teamId() !== undefined && teamProfile.isPending)),
  };
}
