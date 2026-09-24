import { toast } from '@core/component/Toast/Toast';
import UserPlusIcon from '@phosphor/user-plus.svg';
import {
  useCalendarJoinRequestsQuery,
  useRespondToCalendarJoinRequestMutation,
} from '@queries/calendar/join-requests';
import type { CalendarJoinRequestDecision } from '@service-calendar/generated/schemas/calendarJoinRequestDecision';
import { Button } from '@ui';
import { For, Show } from 'solid-js';

/**
 * Channel members who asked to be added to this event after it was shared
 * with their channel. Adding one invites them through the provider, which is
 * why only someone who can edit the event sees the requests.
 */
export function EventJoinRequests(props: {
  eventId: string;
  canModify: boolean;
}) {
  const requests = useCalendarJoinRequestsQuery(
    () => props.eventId,
    () => ({ enabled: props.canModify })
  );
  // Reading `data` while pending would suspend the details panel.
  const pending = () => (requests.isSuccess ? requests.data : []);

  const respond = useRespondToCalendarJoinRequestMutation({
    onSuccess: (request) =>
      toast.success(
        request.status === 'accepted'
          ? `Invited ${request.requesterEmail}`
          : 'Declined the request'
      ),
    onError: (error) =>
      toast.failure(error.message || 'Failed to answer the request'),
  });
  const answer = (
    request: ReturnType<typeof pending>[number],
    decision: CalendarJoinRequestDecision
  ) => respond.mutate({ request, decision });

  return (
    <Show when={props.canModify && pending().length > 0}>
      <div class="border-edge-muted mx-3 mb-3 grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-4 rounded-lg border bg-active p-3 text-sm text-ink-muted sm:mt-2 sm:grid-cols-[1rem_minmax(0,1fr)] sm:gap-x-3 sm:text-xs">
        <span
          aria-hidden="true"
          class="flex size-5 shrink-0 items-center justify-center rounded bg-ink/10 text-ink-muted sm:size-4"
        >
          <UserPlusIcon class="size-3" />
        </span>
        <div class="flex min-w-0 flex-col gap-3">
          <div role="status" class="font-medium text-ink">
            {pending().length === 1
              ? 'Someone asked to join'
              : `${pending().length} people asked to join`}
          </div>
          <For each={pending()}>
            {(request) => (
              <div class="flex min-w-0 items-center justify-between gap-2">
                <span class="min-w-0 truncate">{request.requesterEmail}</span>
                <div class="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="rounded-lg"
                    disabled={respond.isPending}
                    onClick={() => answer(request, 'decline')}
                  >
                    Decline
                  </Button>
                  <Button
                    variant="cta"
                    size="sm"
                    class="rounded-lg"
                    disabled={respond.isPending}
                    onClick={() => answer(request, 'accept')}
                  >
                    Add as guest
                  </Button>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
