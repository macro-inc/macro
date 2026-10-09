/** Native scheduling, as a form's booking step reads it. */
import type { SchedulingProfile } from '@app/features/scheduling/core/types';
import { schedulingKeys } from '@app/features/scheduling/queries/keys';
import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { schedulingClient } from '@service-email/scheduling';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import type {
  FormBookingEvent,
  FormBookingLink,
  ReadSource,
} from '../context/form-context';
import type { FormBookingTarget } from '../core/form-model';
import { loadFailureOf } from './form-sources';

/** A scheduling profile's bookable links, under its owner's name. */
function bookingLinksOf(
  profile: SchedulingProfile,
  owner: string
): FormBookingLink[] {
  return profile.eventTypes
    .filter((event) => event.enabled)
    .map((event) => ({
      target: { profileId: profile.id, eventTypeId: event.id },
      title: event.title,
      durationMinutes: event.durationMinutes,
      owner,
    }));
}

/**
 * The viewer's booking links: their own, then their team's. Read through
 * the Calendar settings' own cache entries, so a link created there shows
 * here without a reload.
 */
export function createBookingLinksSource(
  userId: Accessor<string | undefined>,
  enabled: Accessor<boolean>
): ReadSource<FormBookingLink[]> {
  const personal = useQuery(() => ({
    queryKey: schedulingKeys.settings(userId() ?? 'me').queryKey,
    queryFn: async () =>
      (await throwOnErr(() => schedulingClient.settings())).profile,
    enabled: enabled() && !!userId(),
    retry: false,
  }));
  const team = useCurrentTeamQuery(enabled);
  const teamId = () => (team.isSuccess ? team.data?.team.id : undefined);
  const teamProfile = useQuery(() => ({
    queryKey: schedulingKeys.settings(teamId() ?? '').queryKey,
    queryFn: async () =>
      (await throwOnErr(() => schedulingClient.settings(teamId()))).profile,
    enabled: enabled() && !!teamId(),
    retry: false,
  }));
  return {
    value: () => {
      if (!personal.isSuccess) return undefined;
      if (team.isPending || (teamId() && teamProfile.isPending))
        return undefined;
      // No team, or one whose scheduling the viewer can't read, lists nothing.
      const teamName = team.isSuccess ? team.data?.team.name : undefined;
      const shared =
        teamName && teamProfile.isSuccess
          ? bookingLinksOf(teamProfile.data, teamName)
          : [];
      return [...bookingLinksOf(personal.data, 'Personal'), ...shared];
    },
    failure: () =>
      personal.isError ? loadFailureOf(personal.error) : undefined,
  };
}

/**
 * The event a booking target books, from its public profile, as anyone with
 * the link reads it: `null` once the event is turned off or deleted.
 */
export function createBookingEventSource(
  target: Accessor<FormBookingTarget | undefined>
): ReadSource<FormBookingEvent | null> {
  const profile = useQuery(() => ({
    queryKey: schedulingKeys.publicProfile(target()?.profileId ?? '').queryKey,
    queryFn: async () => {
      const profileId = target()?.profileId ?? '';
      return (await throwOnErr(() => schedulingClient.profile(profileId)))
        .profile;
    },
    enabled: !!target(),
    retry: false,
  }));
  return {
    value: () => {
      const current = target();
      if (!current) return undefined;
      // A deleted profile reads like a deleted event: nothing to book.
      if (
        profile.isError &&
        thrownResultErrorHasCode(profile.error, 'NOT_FOUND')
      )
        return null;
      if (!profile.isSuccess) return undefined;
      const event = profile.data.eventTypes.find(
        (item) => item.id === current.eventTypeId
      );
      return event ? { profile: profile.data, event } : null;
    },
    failure: () =>
      profile.isError && !thrownResultErrorHasCode(profile.error, 'NOT_FOUND')
        ? loadFailureOf(profile.error)
        : undefined,
  };
}
