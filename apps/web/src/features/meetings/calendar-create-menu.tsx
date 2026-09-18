import { getMeetingPath } from '@channel/Call/call-link';
import { toast } from '@core/component/Toast/Toast';
import { useCreateMeetingMutation } from '@queries/call/meetings';
import { useNavigate } from '@solidjs/router';
import { createSignal } from 'solid-js';
import { CalendarCreateMenuView as CreateMenu } from './views/calendar-create-menu';

/** Calendar's event, Quick Call, and scheduled-call creation entry point. */
export function CalendarCreateMenu(props: {
  onEvent: () => void;
  onScheduledCall: () => void;
}) {
  const create = useCreateMeetingMutation();
  const navigate = useNavigate();
  const [pending, setPending] = createSignal(false);

  async function createQuickCall() {
    if (pending()) return;
    setPending(true);
    try {
      const meeting = await create.mutateAsync({ title: 'Quick Call' });
      navigate(`${getMeetingPath(meeting.shareToken)}?join=true`);
    } catch {
      toast.failure('Could not create the call. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <CreateMenu
      pending={pending()}
      onEvent={props.onEvent}
      onQuickCall={() => void createQuickCall()}
      onScheduledCall={props.onScheduledCall}
    />
  );
}
