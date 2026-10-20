import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { queryReadyGate } from '@queries/gate';
import { useLinkedActions, useLinkedChannel } from '@queries/whatsapp-linked';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, For, Show } from 'solid-js';
/** The existing Participants surface explains remote membership and Macro grants. */
export function LinkedGroupControls(props: {
  channelId: string;
  canManage: boolean;
  userId: string;
}) {
  const channel = useLinkedChannel(
    () => props.channelId,
    () => true
  );
  const actions = useLinkedActions();
  const [detach, setDetach] = createSignal(false);
  const [transfer, setTransfer] = createSignal(false);
  const [error, setError] = createSignal('');
  const view = () => (queryReadyGate(channel) ? channel.data : undefined);
  const roster = () => view()?.roster;
  async function detachGroup() {
    setError('');
    try {
      await actions.detach.mutateAsync(props.channelId);
      setDetach(false);
    } catch {
      setError('Could not disconnect this group. Try again.');
    }
  }
  async function ownFutureFiles() {
    setError('');
    try {
      await actions.transfer.mutateAsync({
        channel: props.channelId,
        owner: props.userId,
      });
      setTransfer(false);
    } catch {
      setError(
        'Ownership could not change. Check your Macro management access and WhatsApp membership.'
      );
    }
  }
  return (
    <Panel depth={2} class="h-auto max-h-96 shrink-0 text-ink touch:max-h-none">
      <Panel.Body scroll={!isTouchDevice()} class="touch:overflow-visible">
        <div class="flex flex-col gap-3 p-4">
          <h3 class="font-medium text-sm">WhatsApp participants</h3>
          <p class="text-xs text-ink-muted">
            WhatsApp membership and Macro access are separate. Only verified
            group participants granted Macro access can read this channel.
            Adding Macro access does not add anyone to WhatsApp.
          </p>
          <Show
            when={roster()}
            fallback={
              <p class="text-sm text-ink-muted">
                The WhatsApp roster is temporarily unavailable.
              </p>
            }
          >
            {(group) => (
              <ul class="text-sm space-y-1">
                <For each={group().participants}>
                  {(person) => (
                    <li>
                      {person.displayName ||
                        (person.jid.endsWith('@s.whatsapp.net')
                          ? `+${person.jid.split('@')[0]}`
                          : 'WhatsApp participant')}
                      {person.admin ? ' · Admin' : ''}
                    </li>
                  )}
                </For>
              </ul>
            )}
          </Show>
          <Show when={view()?.binding.ownership_state === 'transfer_required'}>
            <p role="status" class="text-sm text-ink-muted">
              New messages are waiting for a native content owner. A channel
              manager who belongs to this group can take ownership of future
              files.
            </p>
            <Show when={props.canManage}>
              <Button size="sm" onClick={() => setTransfer(true)}>
                Take ownership of future files
              </Button>
            </Show>
          </Show>
          <Show when={props.canManage && view()?.binding.state !== 'detached'}>
            <Button variant="ghost" size="sm" onClick={() => setDetach(true)}>
              Disconnect group from Macro
            </Button>
          </Show>
          <Show when={error()}>
            <p role="alert" class="text-sm text-ink-muted">
              {error()}
            </p>
          </Show>
          <Show when={detach()}>
            <Dialog open onOpenChange={setDetach} class="w-110">
              <Panel depth={2}>
                <Panel.Body>
                  <div class="flex flex-col gap-4 p-6">
                    <Dialog.Title class="font-semibold">
                      Disconnect this group from Macro?
                    </Dialog.Title>
                    <p class="text-sm">
                      Macro stops synchronizing and sending. The WhatsApp group,
                      its participants, and your existing Macro history stay
                      intact.
                    </p>
                    <Button
                      disabled={actions.detach.isPending}
                      onClick={() => void detachGroup()}
                    >
                      Disconnect group
                    </Button>
                    <Button variant="ghost" onClick={() => setDetach(false)}>
                      Cancel
                    </Button>
                  </div>
                </Panel.Body>
              </Panel>
            </Dialog>
          </Show>
          <Show when={transfer()}>
            <Dialog open onOpenChange={setTransfer} class="w-110">
              <Panel depth={2}>
                <Panel.Body>
                  <div class="flex flex-col gap-4 p-6">
                    <Dialog.Title class="font-semibold">
                      Own future files for this channel?
                    </Dialog.Title>
                    <p class="text-sm">
                      New incoming files will be private native documents owned
                      by you and shared with this channel’s authorized audience.
                      Existing files keep their current owners.
                    </p>
                    <Button
                      disabled={actions.transfer.isPending}
                      onClick={() => void ownFutureFiles()}
                    >
                      Take ownership
                    </Button>
                    <Button variant="ghost" onClick={() => setTransfer(false)}>
                      Cancel
                    </Button>
                  </div>
                </Panel.Body>
              </Panel>
            </Dialog>
          </Show>
        </div>
      </Panel.Body>
    </Panel>
  );
}
