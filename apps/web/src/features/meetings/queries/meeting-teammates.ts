import { macroIdToEmail, tryMacroId } from '@core/user/macroId';
import { useCurrentTeamQuery } from '@queries/team/teams';
import * as EmailValidator from 'email-validator';
import { type Accessor, createMemo } from 'solid-js';
import type {
  MeetingInvitePerson,
  MeetingTeammatesSource,
} from '../context/meeting-invite';

/** Only teammates from a roster that belongs to the signed-in account. */
export function useMeetingTeammatesSource(
  userId: Accessor<string | undefined>,
  displayName: (userId: string) => string
): MeetingTeammatesSource {
  const query = useCurrentTeamQuery(() => Boolean(userId()));
  const team = () => (query.isSuccess ? query.data : undefined);
  const belongsToViewer = () =>
    Boolean(userId()) &&
    team()?.members.some((member) => member.user_id === userId());

  return {
    people: createMemo(() => {
      const viewerId = tryMacroId(userId() ?? '');
      if (!viewerId || !belongsToViewer()) return [];
      const viewerEmailKey = macroIdToEmail(viewerId).toLowerCase();
      const seen = new Set<string>();
      return (team()?.members ?? []).flatMap(
        (member): MeetingInvitePerson[] => {
          const id = tryMacroId(member.user_id);
          if (!id || id === userId()) return [];
          const email = macroIdToEmail(id);
          const emailKey = email.toLowerCase();
          if (
            emailKey === viewerEmailKey ||
            !EmailValidator.validate(email) ||
            seen.has(emailKey)
          )
            return [];
          seen.add(emailKey);
          return [{ id, email, name: displayName(id) || email }];
        }
      );
    }),
    loading: () => Boolean(userId()) && query.isPending,
    error: () =>
      userId() && (query.isError || (team() && !belongsToViewer()))
        ? 'Could not load your teammates. Please try again.'
        : undefined,
    refresh: () => {
      if (userId()) void query.refetch();
    },
  };
}
