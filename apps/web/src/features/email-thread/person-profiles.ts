import { useThreadPersonProfilesQuery } from '@queries/email/person-profiles';
import { queryReadyGate } from '@queries/gate';
import type { Accessor } from 'solid-js';
import type { PersonProfile } from '../email-message/core/person-profile';

/** Looks up the public profiles of the thread's people. Never suspends: the
 * thread renders without profiles until they load. */
export function createThreadPersonProfiles(threadId: Accessor<string>) {
  const query = useThreadPersonProfilesQuery(threadId);
  return (email: string): PersonProfile | undefined => {
    if (!queryReadyGate(query)) return undefined;
    const profile = query.data[email.toLowerCase()];
    if (!profile) return undefined;
    return {
      linkedinUrl: profile.linkedin_url ?? undefined,
      headline: profile.headline ?? undefined,
      title: profile.title ?? undefined,
      organizationName: profile.organization_name ?? undefined,
      photoUrl: profile.photo_url ?? undefined,
    };
  };
}
