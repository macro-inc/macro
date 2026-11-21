// Copy of main's apps/web/src/lib/queries/storage/forms.ts (useFormInvitedCount) at 393eee931fa9b40400297c3237ce1ad3e00323d3, verbatim below the marker
// except the import lines listed in check-copies.sh (paths that main resolved
// relative to its own directory). The proof runner checks this.
// ---- verbatim below ----
import { useFormSharePermissionsQuery } from '@queries/storage/forms';
import { useQueries } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { channelParticipantsQueryOptions } from './channel-participants';

/**
 * How many distinct people the channels a form was posted in hold, for "n% of
 * invited": `null` when it was posted nowhere, undefined while reading.
 * Sharing is owner-only, so other editors read nothing.
 */
export function useFormInvitedCount(
  formId: Accessor<string | undefined>,
  /** Not counted: the owner is in every channel they posted to. */
  ownerId: Accessor<string | undefined>,
  enabled: Accessor<boolean>
) {
  const permissions = useFormSharePermissionsQuery(formId, enabled);
  const channelIds = () =>
    permissions.isSuccess
      ? (permissions.data.channelSharePermissions ?? []).map(
          (grant) => grant.channel_id
        )
      : [];
  const participants = useQueries(() => ({
    queries: channelIds().map(channelParticipantsQueryOptions),
  }));
  return {
    count: (): number | null | undefined => {
      if (!permissions.isSuccess) return undefined;
      if (channelIds().length === 0) return null;
      if (!participants.every((query) => query.isSuccess)) return undefined;
      const people = new Set(
        participants.flatMap((query) =>
          (query.data ?? []).map((participant) => participant.user_id)
        )
      );
      const owner = ownerId();
      if (owner) people.delete(owner);
      return people.size;
    },
    error: () =>
      permissions.error ?? participants.find((query) => query.isError)?.error,
  };
}
