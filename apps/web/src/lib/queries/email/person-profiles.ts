import { throwOnErr } from '@core/util/result';
import { emailClient } from '@service-email/client';
import type {
  PersonProfile,
  ThreadPersonProfiles,
} from '@service-email/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { emailKeys } from './keys';

/** Public profiles of a thread's people, keyed by lowercased email address. */
export type PersonProfilesByEmail = Record<string, PersonProfile>;

/** The server caches profiles for months; a session never needs a refetch. */
const STALE_TIME = 30 * 60_000;

function byEmail({ profiles }: ThreadPersonProfiles): PersonProfilesByEmail {
  return Object.fromEntries(profiles.map((p) => [p.email_address, p]));
}

export function useThreadPersonProfilesQuery(threadId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: emailKeys.threadPersonProfiles(threadId()).queryKey,
    queryFn: () =>
      throwOnErr(() => emailClient.getThreadPersonProfiles(threadId())),
    select: byEmail,
    staleTime: STALE_TIME,
  }));
}
