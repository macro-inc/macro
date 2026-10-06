import { BookingLinkDraftComposer } from '@app/features/scheduling/components/booking-link-draft-composer';
import type { BookingLinkArgs } from '@app/features/scheduling/core/booking-link';
import { useSchedulingProfileQuery } from '@app/features/scheduling/queries/source';
import { useUserId } from '@core/context/user';
import { getDisplayName, macroIdToEmail, tryMacroId } from '@core/user';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { Button } from '@ui';
import { Show, Suspense } from 'solid-js';
import type { UserToolReviewSink } from '../user-tool-review';

type Props = {
  initialData: BookingLinkArgs;
  sink: UserToolReviewSink<BookingLinkArgs>;
};
function Content(props: Props) {
  const user = useUserId();
  const profile = useSchedulingProfileQuery(() => ({
    id: props.initialData.teamId ?? user() ?? 'me',
    teamId: props.initialData.teamId ?? undefined,
    name: '',
    canEdit: true,
  }));
  const team = useCurrentTeamQuery(() => !!props.initialData.teamId);
  const members = () => {
    const data = team.isSuccess ? team.data : undefined;
    const roster =
      data && data.team.id === props.initialData.teamId
        ? data.members
        : props.initialData.draft.event.hosts.map((user_id) => ({ user_id }));
    return roster.map((member) => {
      const id = tryMacroId(member.user_id);
      return {
        id: member.user_id,
        name: id ? getDisplayName(id) : member.user_id,
        email: id ? macroIdToEmail(id) : member.user_id,
      };
    });
  };
  return (
    <>
      <Show
        when={profile.isError || (!!props.initialData.teamId && team.isError)}
      >
        <div role="status" class="mb-3 text-sm text-ink-muted">
          Could not load current booking settings. Your draft is preserved.
          <Button
            variant="ghost"
            onClick={() => {
              void profile.refetch();
              if (props.initialData.teamId) void team.refetch();
            }}
          >
            Retry loading
          </Button>
        </div>
      </Show>
      <BookingLinkDraftComposer
        {...props}
        members={members()}
        events={profile.isSuccess ? profile.data.eventTypes : []}
      />
    </>
  );
}
/** Local boundary prevents settings queries from suspending the transcript. */
export function BookingDraftComposer(props: Props) {
  return (
    <Suspense
      fallback={<p class="p-4 text-ink-muted">Loading booking editor…</p>}
    >
      <Content {...props} />
    </Suspense>
  );
}
