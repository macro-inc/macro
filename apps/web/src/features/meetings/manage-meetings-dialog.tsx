import { getMeetingUrl } from '@app/features/channel/Call/call-link';
import { toast } from '@core/component/Toast/Toast';
import { writeClipboardData } from '@core/util/dataTransfer';
import {
  useCancelMeetingMutation,
  useMeetingsQuery,
} from '@queries/call/meetings';
import { useNavigate } from '@solidjs/router';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, Match, Switch } from 'solid-js';
import { type ManagedMeeting, MeetingList } from './components/meeting-list';

/** App composition for managing reusable call links. Scheduling stays in Calendar. */
export function ManageMeetingsDialog(props: { onClose: () => void }) {
  const meetings = useMeetingsQuery();
  const cancel = useCancelMeetingMutation();
  const navigate = useNavigate();
  const [confirmId, setConfirmId] = createSignal<string>();
  const list = (): ManagedMeeting[] =>
    meetings.isSuccess
      ? meetings.data.map((meeting) => ({
          id: meeting.id,
          title: meeting.title,
          url: getMeetingUrl(meeting.shareToken),
          active: Boolean(meeting.callId),
        }))
      : [];

  const copy = async (meeting: ManagedMeeting) => {
    if (await writeClipboardData({ 'text/plain': meeting.url })) {
      toast.success('Call link copied');
    } else {
      toast.failure(
        'Could not copy link. Select the link and copy it manually.'
      );
    }
  };

  const revoke = async (id: string) => {
    try {
      await cancel.mutateAsync(id);
      setConfirmId(undefined);
      toast.success('Call link revoked');
    } catch {
      toast.failure('Could not revoke call link. Please try again.');
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      position="center"
      class="w-140 max-w-[calc(100vw-2rem)]"
    >
      <Panel depth={2} class="rounded-xl">
        <Panel.Header class="px-6">
          <Dialog.Title class="text-sm font-semibold text-ink">
            Your call links
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="px-6 pb-6">
          <Dialog.Description class="text-sm text-ink-muted mb-2">
            Anyone with a link can join, including guests without a Macro
            account. Manage scheduled events in Calendar.
          </Dialog.Description>
          <div class="max-h-[60vh] overflow-y-auto">
            <Switch>
              <Match when={meetings.isPending}>
                <p class="py-8 text-sm text-ink-muted">Loading call links…</p>
              </Match>
              <Match when={meetings.isError}>
                <p class="py-4 text-sm text-ink-muted">
                  Could not load your call links.
                </p>
                <Button
                  variant="outline"
                  onClick={() => void meetings.refetch()}
                >
                  Try again
                </Button>
              </Match>
              <Match when={list().length === 0}>
                <p class="py-8 text-sm text-ink-muted">
                  Add a Macro call to a calendar event to get your first link.
                </p>
              </Match>
              <Match when={list().length > 0}>
                <MeetingList
                  meetings={list()}
                  confirmId={confirmId()}
                  revokingId={cancel.isPending ? cancel.variables : undefined}
                  onCopy={(meeting) => void copy(meeting)}
                  onJoin={(meeting) => {
                    props.onClose();
                    const url = new URL(meeting.url);
                    navigate(url.pathname.replace(/^\/app/, ''));
                  }}
                  onRequestRevoke={setConfirmId}
                  onRevoke={(id) => void revoke(id)}
                />
              </Match>
            </Switch>
          </div>
          <div class="flex justify-end pt-4">
            <Button variant="ghost" onClick={props.onClose}>
              Done
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
