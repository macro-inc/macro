import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { EntityData } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import { publishDraftLifecycleChange } from '@queries/email/draft-lifecycle-events';
import { useEmailLinksQuery } from '@queries/email/link';
import {
  fetchScheduledMessages,
  useScheduledMessagesQuery,
} from '@queries/email/scheduled';
import { useUnscheduleMessageMutation } from '@queries/email/thread';
import type { Message } from '@service-email/generated/schemas';
import { Button, EmptyStatePanel } from '@ui';
import { format } from 'date-fns/format';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { persistSoupNavigationTouchHighlight } from '../../next-soup/soup-view/soup-navigation-touch-highlight';
import { openEntityInSplitFromUnifiedList } from '../../next-soup/utils';
import { useEmailView } from '../email-view-context';

function recipientLabel(message: Message): string {
  const recipient = message.to[0];
  if (!recipient) return 'No recipient';
  const label = recipient.name?.trim() || recipient.email;
  return message.to.length > 1 ? `${label} +${message.to.length - 1}` : label;
}

export function ScheduledEmailList(props: {
  ref?: (element: HTMLDivElement) => void;
}) {
  const { state, openThread } = useEmailView();
  const panel = useSplitPanelOrThrow();
  const links = useEmailLinksQuery();
  const linkIds = createMemo(() => {
    if (!links.isSuccess) return [];
    const available = links.data.links.map((link) => link.id);
    if (state.inboxIds === undefined) return available;
    const selected = new Set(state.inboxIds);
    return available.filter((id) => selected.has(id));
  });
  const scheduled = useScheduledMessagesQuery(
    linkIds,
    () => state.tab === 'scheduled' && links.isSuccess
  );
  const unschedule = useUnscheduleMessageMutation();
  const [cancellingId, setCancellingId] = createSignal<string>();

  const cancel = async (message: Message) => {
    if (cancellingId()) return;
    setCancellingId(message.db_id);
    try {
      await unschedule.mutateAsync({
        draftID: message.db_id,
        linkId: message.link_id,
      });
      publishDraftLifecycleChange(message.db_id, message.link_id);
      toast.success('Schedule cancelled. The email is back in Drafts.');
      // The mutation response is authoritative. Refresh is presentation-only
      // and must not turn a successful cancellation into a reported failure.
      void scheduled.refetch().catch(() => {});
    } catch {
      try {
        const capturedInbox = await fetchScheduledMessages([message.link_id]);
        const stillScheduled = capturedInbox.some(
          (candidate) => candidate.db_id === message.db_id
        );
        if (stillScheduled) {
          toast.failure('Failed to cancel scheduled email');
        } else {
          toast.alert(
            'This email is no longer scheduled. It may already have been sent.'
          );
        }
      } catch {
        toast.failure(
          'Could not confirm whether the schedule was cancelled. Refresh and check again.'
        );
      }
    } finally {
      setCancellingId(undefined);
    }
  };

  return (
    <div
      ref={props.ref}
      role="list"
      aria-label="Scheduled emails"
      tabIndex={0}
      class="size-full min-h-0 min-w-0 overflow-y-auto outline-none touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)"
    >
      <Switch>
        <Match when={links.isLoading || scheduled.isLoading}>
          <div class="grid size-full place-items-center text-ink-muted">
            <SpinnerIcon
              aria-label="Loading scheduled emails"
              class="size-5 animate-spin"
            />
          </div>
        </Match>
        <Match when={links.isError || scheduled.isError}>
          <EmptyStatePanel
            centered
            title="Scheduled email is unavailable"
            description="Refresh to check your scheduled messages again."
            primaryAction={{
              label: 'Refresh',
              onClick: () =>
                void links.refetch().then(() => scheduled.refetch()),
            }}
          />
        </Match>
        <Match when={linkIds().length === 0}>
          <EmptyStatePanel
            centered
            title="No inboxes selected"
            description="Pick an inbox to see its scheduled email."
          />
        </Match>
        <Match when={(scheduled.data?.length ?? 0) === 0}>
          <EmptyStatePanel
            centered
            title="No scheduled email"
            description="Email you schedule to send later will appear here."
          />
        </Match>
        <Match when={scheduled.data}>
          {(messages) => (
            <div
              class="mx-auto flex w-full max-w-3xl flex-col gap-1 p-3"
              classList={{ 'pt-2': isTouchDevice() }}
            >
              <For each={messages()}>
                {(message) => {
                  const sendTime = () => new Date(message.scheduled_send_time!);
                  const isOverdue = () => sendTime().getTime() <= Date.now();
                  return (
                    <div
                      role="listitem"
                      class="flex min-w-0 items-center gap-3 rounded-xl border border-edge-muted bg-surface px-3 py-2.5"
                    >
                      <button
                        type="button"
                        class="min-w-0 flex-1 text-left"
                        onClick={(event) => {
                          const thread = {
                            id: message.thread_db_id,
                            fallbackName: message.subject ?? 'Scheduled email',
                          };
                          const openInNewSplit = event.shiftKey;
                          if (
                            !openInNewSplit &&
                            !event.altKey &&
                            openThread(thread, { event })
                          ) {
                            return;
                          }
                          const finishTouchHighlight =
                            persistSoupNavigationTouchHighlight(event);
                          const entity: EntityData = {
                            type: 'email',
                            id: thread.id,
                            name: thread.fallbackName,
                            ownerId: '',
                            isRead: message.is_read,
                            isDraft: message.is_draft,
                            isImportant: false,
                            done: false,
                            linkId: message.link_id,
                            snippet: message.snippet ?? undefined,
                          };
                          void openEntityInSplitFromUnifiedList(entity, {
                            splitHandle: panel.handle,
                            referredFrom: 'mail',
                            openInNewSplit,
                          }).finally(finishTouchHighlight);
                        }}
                      >
                        <div class="truncate text-sm font-medium text-ink">
                          To: {recipientLabel(message)}
                        </div>
                        <div class="truncate text-sm text-ink-muted">
                          {message.subject || '(No subject)'}
                          <Show when={message.snippet}>
                            {(snippet) => ` — ${snippet()}`}
                          </Show>
                        </div>
                      </button>
                      <time
                        datetime={message.scheduled_send_time ?? undefined}
                        class="shrink-0 text-xs font-medium"
                        classList={{
                          'text-accent': !isOverdue(),
                          'text-failure': isOverdue(),
                        }}
                      >
                        {isOverdue() ? 'Overdue: ' : ''}
                        {format(sendTime(), "MMM d 'at' h:mm a")}
                      </time>
                      <Button
                        size="sm"
                        variant="ghost"
                        label="Cancel scheduled send"
                        disabled={cancellingId() !== undefined}
                        onClick={() => void cancel(message)}
                      >
                        {cancellingId() === message.db_id
                          ? 'Cancelling…'
                          : 'Cancel'}
                      </Button>
                    </div>
                  );
                }}
              </For>
            </div>
          )}
        </Match>
      </Switch>
    </div>
  );
}
