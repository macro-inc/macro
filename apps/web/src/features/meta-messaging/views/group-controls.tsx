import { isRecord } from '@app/lib/split-router';
import { channelDetailRoute, homeChannelRoute } from '@app/routes/routes';
import { globalSplitManager } from '@app/signal/splitLayout';
import { globalRemoveFromSplitHistory } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Button, ConfirmDialog, confirmDialog, Panel } from '@ui';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { groupError } from '../core/group';
import { useWhatsappGroup } from '../queries/groups';

/** Existing Participants surface hosts external people; controls never add phone numbers. */
export function WhatsappGroupControls(props: {
  channelId: string;
  setupOnly?: boolean;
}) {
  const source = useWhatsappGroup(() => props.channelId);
  const [deleting, setDeleting] = createSignal<'discard' | 'delete'>();
  const [removing, setRemoving] = createSignal<string>();
  const [removedRequest, setRemovedRequest] = createSignal<string>();
  let mounted = true;
  onCleanup(() => {
    mounted = false;
  });
  const setup = () => source.group()?.setup;
  const removalError =
    'Could not confirm the removal request. Check the participant list before retrying.';
  const deletionError =
    'The channel could not be deleted. It is still available so you can retry.';
  const error = () =>
    source.retry.error
      ? groupError(source.retry.error.message)
      : source.copy.error
        ? 'Could not copy the invite link. Try again.'
        : source.remove.error
          ? removalError
          : source.destroy.error
            ? deletionError
            : undefined;
  const retry = async () => {
    if (
      setup()?.state === 'unknown' &&
      !(await confirmDialog({
        title: 'Retry WhatsApp group creation?',
        body: 'The earlier attempt may have left an unused group in WhatsApp. This creates a new attempt and abandons the earlier invite link.',
        confirmLabel: 'Create another attempt',
      }))
    )
      return;
    source.retry.mutate();
  };
  const destroy = async () => {
    const id = props.channelId;
    try {
      await source.destroy.mutateAsync({
        id,
        discard: deleting() === 'discard',
      });
    } catch {
      // The mutation exposes the error and leaves the channel available.
      return;
    }
    if (mounted && props.channelId === id) setDeleting(undefined);
    // This continuation survives leaving Participants while deletion is pending.
    const manager = globalSplitManager();
    if (manager)
      globalRemoveFromSplitHistory(manager, (entry) => {
        if (entry.type === 'channel' && entry.id === id) return true;
        // Routed channel details retain the list shell's id in SplitContent.
        const metadata = isRecord(entry.entryMetadata)
          ? entry.entryMetadata
          : undefined;
        const route = isRecord(metadata?.route) ? metadata.route : undefined;
        return (
          Array.isArray(route?.matches) &&
          route.matches.some(
            (match) =>
              isRecord(match) &&
              (match.id === channelDetailRoute.id ||
                match.id === homeChannelRoute.id) &&
              isRecord(match.params) &&
              match.params.channelId === id
          )
        );
      });
  };
  return (
    <Show when={source.group()}>
      {(group) => (
        <Panel
          depth={2}
          class="h-auto max-h-96 shrink-0 text-ink touch:max-h-none"
        >
          <Panel.Header class="flex-wrap justify-between gap-2 px-6 py-2">
            <h3 class="text-sm font-semibold">
              {setup() ? 'WhatsApp group setup' : 'WhatsApp participants'}
            </h3>
            <Show when={group().can_copy_link && !source.destroy.isSuccess}>
              <Button
                variant="outline"
                class="min-h-11"
                disabled={
                  source.copy.isPending ||
                  (!source.linkReady() && !source.linkError())
                }
                onClick={() =>
                  source.linkError()
                    ? source.refreshLink()
                    : source.copy.mutate(undefined, {
                        onSuccess: () => toast.success('Invite link copied'),
                      })
                }
              >
                {source.linkError()
                  ? 'Retry invite link'
                  : 'Copy WhatsApp invite link'}
              </Button>
            </Show>
          </Panel.Header>
          <Panel.Body
            scroll={!isTouchDevice()}
            class="px-6 py-3 touch:overflow-visible"
          >
            <Show
              when={!source.destroy.isSuccess}
              fallback={
                <p role="status">
                  {setup() ? 'Setup discarded.' : 'Group deleted.'}
                </p>
              }
            >
              <Show when={setup()}>
                {(pending) => (
                  <div class="flex flex-col gap-2">
                    <p role="status">
                      {pending().state === 'unknown'
                        ? 'Could not confirm creation'
                        : pending().state === 'failed'
                          ? groupError(pending().error_code)
                          : 'Waiting for WhatsApp to confirm this group…'}
                    </p>
                    <Show when={pending().state === 'unknown'}>
                      <p class="text-sm text-ink-muted">
                        The account’s group callback setup may be incomplete.
                        The earlier attempt may have created a group; check
                        setup before retrying. Creation will not repeat
                        automatically.
                      </p>
                    </Show>
                    <Show when={group().can_retry}>
                      <Button
                        variant="outline"
                        class="min-h-11 self-start"
                        disabled={source.retry.isPending}
                        onClick={() => void retry()}
                      >
                        Retry creation
                      </Button>
                    </Show>
                  </div>
                )}
              </Show>
              <Show when={group().status === 'suspended'}>
                <p role="status">
                  WhatsApp suspended this group. Replies are unavailable until
                  WhatsApp clears it.
                </p>
              </Show>
              <Show when={group().status === 'deleted'}>
                <p role="status">
                  This WhatsApp group was deleted. Its owner can delete the
                  remaining Macro channel.
                </p>
              </Show>
              <Show when={!props.setupOnly && !setup()}>
                <p class="mb-2 text-xs text-ink-muted">
                  These people participate in WhatsApp. Macro teammates reply as
                  the connected business.
                </p>
                <Show
                  when={group().participants.length > 0}
                  fallback={
                    <Show
                      when={
                        group().can_copy_link && group().status === 'active'
                      }
                      fallback={
                        <p class="py-2 text-sm text-ink-muted">
                          No participants to display.
                        </p>
                      }
                    >
                      <p class="py-2 text-sm text-ink-muted">
                        No one has joined yet — share the invite link.
                      </p>
                    </Show>
                  }
                >
                  <ul
                    aria-label="WhatsApp participants"
                    class="divide-y divide-edge-divider"
                  >
                    <For each={group().participants}>
                      {(person) => (
                        <li class="flex min-h-14 items-center justify-between gap-3 border-b border-edge-divider py-2">
                          <div class="min-w-0">
                            <p class="truncate text-sm">
                              {person.display_name ||
                                (person.username
                                  ? `@${person.username}`
                                  : person.phone) ||
                                'WhatsApp participant'}
                            </p>
                            <p class="truncate text-xs text-ink-muted">
                              {person.display_name
                                ? (person.username
                                    ? `@${person.username}`
                                    : person.phone) || person.customer_id
                                : person.customer_id}
                            </p>
                          </div>
                          <Show when={group().can_remove}>
                            <Button
                              variant="ghost"
                              class="min-h-11"
                              disabled={source.remove.isPending}
                              onClick={() =>
                                setRemoving(person.external_sender_id)
                              }
                            >
                              Remove
                            </Button>
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
                <Show
                  when={
                    removedRequest() &&
                    group().participants.some(
                      (p) => p.external_sender_id === removedRequest()
                    )
                  }
                >
                  <p role="status" class="text-xs text-ink-muted">
                    Removal requested. Waiting for WhatsApp confirmation.
                  </p>
                </Show>
              </Show>
              <Show
                when={
                  group().can_delete &&
                  (!setup() ||
                    setup()?.state === 'failed' ||
                    setup()?.state === 'unknown')
                }
              >
                <Button
                  variant="ghost"
                  class="mt-2 min-h-11"
                  onClick={() => setDeleting(setup() ? 'discard' : 'delete')}
                >
                  {setup()
                    ? 'Discard setup'
                    : group().status === 'deleted'
                      ? 'Delete remaining Macro channel'
                      : 'Delete WhatsApp group'}
                </Button>
              </Show>
            </Show>
            <Show when={error()}>
              <p role="alert" class="mt-2 text-sm text-failure-ink">
                {error()}
              </p>
            </Show>
          </Panel.Body>
          <ConfirmDialog
            open={!!removing()}
            onOpenChange={(open) => {
              if (!open) setRemoving(undefined);
            }}
            title="Remove WhatsApp participant?"
            body={
              <>
                <p>
                  This person will be removed from the WhatsApp group and cannot
                  rejoin through its invite link.
                </p>
                <Show when={source.remove.error}>
                  <p role="alert" class="mt-2 text-failure-ink">
                    {removalError}
                  </p>
                </Show>
              </>
            }
            confirmLabel="Remove participant"
            pending={source.remove.isPending}
            onConfirm={() => {
              const person = removing();
              if (person)
                source.remove.mutate(person, {
                  onSuccess: () => {
                    setRemovedRequest(person);
                    setRemoving(undefined);
                  },
                });
            }}
          />
          <ConfirmDialog
            open={!!deleting()}
            onOpenChange={(open) => {
              if (!open) setDeleting(undefined);
            }}
            title={
              deleting() === 'discard'
                ? 'Discard local setup?'
                : group().status === 'deleted'
                  ? 'Delete remaining Macro channel?'
                  : 'Delete WhatsApp group for everyone?'
            }
            body={
              <>
                <p>
                  {deleting() === 'discard'
                    ? 'This removes the local setup. It does not delete any unused group the earlier attempt may have created in WhatsApp.'
                    : group().status === 'deleted'
                      ? 'WhatsApp has confirmed deletion. This removes the remaining Macro channel.'
                      : 'This deletes the WhatsApp group for everyone and removes this Macro channel. If WhatsApp does not confirm deletion, the channel will remain so you can retry.'}
                </p>
                <Show when={source.destroy.error}>
                  <p role="alert" class="mt-2 text-failure-ink">
                    {deletionError}
                  </p>
                </Show>
              </>
            }
            confirmLabel={
              deleting() === 'discard'
                ? 'Discard setup'
                : group().status === 'deleted'
                  ? 'Delete remaining Macro channel'
                  : 'Delete group for everyone'
            }
            pending={source.destroy.isPending}
            onConfirm={destroy}
          />
        </Panel>
      )}
    </Show>
  );
}
