import { Button } from '@ui';
import { For, Show } from 'solid-js';

export type ManagedMeeting = {
  id: string;
  title: string;
  url: string;
  active: boolean;
};

export function MeetingList(props: {
  meetings: ManagedMeeting[];
  revokingId?: string;
  confirmId?: string;
  onJoin: (meeting: ManagedMeeting) => void;
  onCopy: (meeting: ManagedMeeting) => void;
  onRequestRevoke: (id: string | undefined) => void;
  onRevoke: (id: string) => void;
}) {
  return (
    <div class="ph-no-capture flex flex-col divide-y divide-edge-muted">
      <For each={props.meetings}>
        {(meeting) => (
          <div class="py-4 flex flex-col gap-3">
            <div class="flex items-center justify-between gap-3">
              <span class="font-medium text-ink truncate">{meeting.title}</span>
              <Show when={meeting.active}>
                <span class="text-xs text-accent shrink-0">In progress</span>
              </Show>
            </div>
            <input
              aria-label={`Call link for ${meeting.title}`}
              readOnly
              value={meeting.url}
              onFocus={(event) => event.currentTarget.select()}
              class="w-full rounded-lg border border-edge-muted bg-input px-3 py-2 text-xs text-ink-muted"
            />
            <Show
              when={props.confirmId === meeting.id}
              fallback={
                <div class="flex gap-2">
                  <Button
                    size="sm"
                    variant="accent"
                    onClick={() => props.onJoin(meeting)}
                  >
                    Join call
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => props.onCopy(meeting)}
                  >
                    Copy link
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    class="ml-auto"
                    onClick={() => props.onRequestRevoke(meeting.id)}
                  >
                    Revoke link
                  </Button>
                </div>
              }
            >
              <p class="text-xs text-ink-muted">
                This link will no longer let people join. Current participants
                can stay in the call, and calendar invitations are kept.
              </p>
              <div class="flex gap-2 justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={props.revokingId === meeting.id}
                  onClick={() => props.onRequestRevoke(undefined)}
                >
                  Keep link
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={props.revokingId === meeting.id}
                  onClick={() => props.onRevoke(meeting.id)}
                >
                  {props.revokingId === meeting.id
                    ? 'Revoking…'
                    : 'Revoke link'}
                </Button>
              </div>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}
